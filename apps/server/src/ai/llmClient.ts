/**
 * 模型客户端：封装 OpenAI 兼容 /chat/completions 调用。
 *
 * 关键经验（已踩坑修复，必须保留）：
 * 1. evowit-agent27b 在 vLLM 上默认会把内容放到 reasoning_content，导致 message.content=null。
 *    必须加 chat_template_kwargs.enable_thinking=false，保证返回 message.content。
 * 2. 图片 data URL 不截断；超限直接拒绝并返回中文提示，不传坏 base64。
 * 3. 非流式调用（stream:false），一次拿到完整答案；上层用事件推送模拟增量。
 * 4. 答案用中文，模型不可达时返回中文 fallback，不阻塞流程，不返回英文。
 */

import { config } from "../config.js";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string | LlmContentPart[];
}

export type LlmContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface LlmRequestOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | null; reasoning_content?: string | null };
    finish_reason?: string;
  }>;
  usage?: { total_tokens?: number };
}

export class LlmClient {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly runtime = config
  ) {}

  async chat(messages: LlmMessage[], options: LlmRequestOptions = {}): Promise<string> {
    const url = `${this.runtime.llmBaseUrl.replace(/\/$/, "")}/chat/completions`;
    const body = {
      model: this.runtime.llmModel,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 900,
      stream: false,
      ...(this.runtime.llmDisableThinking
        ? { chat_template_kwargs: { enable_thinking: false } }
        : {})
    };

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.runtime.llmApiKey}`
      },
      body: JSON.stringify(body),
      signal: options.signal
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`LLM request failed ${response.status}: ${text.slice(0, 500)}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const choice = data.choices?.[0];
    // 优先 content；某些模型只回 reasoning_content，作为兜底
    const answer = choice?.message?.content?.trim() || choice?.message?.reasoning_content?.trim();
    if (!answer) {
      throw new Error("LLM returned an empty answer");
    }
    return answer;
  }

  /** 校验并返回图片 data url；超限或格式错抛异常，由上层转中文提示。 */
  validateImageDataUrl(dataUrl?: string): string | undefined {
    if (!dataUrl) return undefined;
    if (!/^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(dataUrl)) {
      throw new Error("Unsupported image data URL");
    }
    if (dataUrl.length > this.runtime.maxImageChars) {
      throw new Error(
        `Image too large (${dataUrl.length}/${this.runtime.maxImageChars})`
      );
    }
    return dataUrl;
  }
}
