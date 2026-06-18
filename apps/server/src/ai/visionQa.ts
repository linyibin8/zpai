/**
 * 视觉问答（实时帮助核心）。
 *
 * 行为约定（对齐产品文档）：
 * - 结合当前画面 + 最近学习上下文回答；普通追问沿用上一题上下文，不要求每次重拍。
 * - 看不清时提示重新拍摄，绝不编造题目内容。
 * - 答案短、清楚、适合学生理解；长答案优先讲思路和关键步骤。
 * - 模型不可达时返回中文 fallback。
 */

import type { Message } from "@zpai/shared";
import type { LlmClient, LlmMessage } from "./llmClient.js";

export interface VisionQaInput {
  question: string;
  /** 当前帧图片 data url；为空则纯文本追问。 */
  imageDataUrl?: string;
  /** 会话历史（最近若干轮）。 */
  context: Message[];
  /** 是否复习场景（不抓当前镜头，基于错题上下文）。 */
  isReview?: boolean;
  signal?: AbortSignal;
}

const SYSTEM_PROMPT = [
  "你是 zpai，一个陪伴学生学习的助手，通过 iPhone 镜头观察学生的书本和作业。",
  "请用中文回答，语气简短、温暖、适合学生听懂、方便用语音朗读。",
  "讲解时优先给思路、关键步骤和检查点，而不是直接给最终答案；学生追问时再给更细的步骤。",
  "如果图片不清晰、题目被遮挡或看不出题目内容，就明确告诉学生看不清，请他把镜头靠近题目重新拍摄，绝不要凭空编造题目内容。",
  "如果学生问的是具体某一步哪里错了，先指出可能的错误位置和原因，再给修正方向。",
  "如果学生要求换一种简单的方法讲，就换更基础、更直观的讲法。"
].join("\n");

const REVIEW_SYSTEM_PROMPT = [
  "现在进入复习模式。学生正在复习一道之前做错的题。",
  "不要分析当前镜头内容（复习回合不抓镜头，避免污染上下文）。",
  "基于提供的错题信息（题目、错因、知识点、下一步建议）引导学生重新作答或讲解。",
  "如果学生答对，给予肯定并提示可以标记掌握；如果还错，再次讲清关键步骤。",
  "回答保持简短、中文、适合朗读。"
].join("\n");

const FALLBACK = "我现在没有成功读取到画面。请把镜头靠近题目、保持清晰后重拍，或者先把题目文字发给我，我会一步一步帮你做。";

export class VisionQa {
  constructor(private readonly llm: LlmClient) {}

  async answer(input: VisionQaInput): Promise<string> {
    try {
      const messages = this.buildMessages(input);
      return await this.llm.chat(messages, {
        temperature: 0.3,
        maxTokens: 900,
        signal: input.signal
      });
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      // 相机/图片类失败：明确提示重拍，不编造
      return FALLBACK;
    }
  }

  private buildMessages(input: VisionQaInput): LlmMessage[] {
    const system = input.isReview ? REVIEW_SYSTEM_PROMPT : SYSTEM_PROMPT;
    const history: LlmMessage[] = input.context
      .slice(-this.historyLimit())
      .map((m) => ({
        role: m.actor === "assistant" ? "assistant" : "user",
        content: m.text
      }));

    let userContent: LlmMessage["content"];
    if (input.isReview) {
      // 复习回合不抓镜头，纯文本
      userContent = input.question;
    } else {
      const imageUrl = this.safeImageUrl(input.imageDataUrl);
      userContent = imageUrl
        ? [
            { type: "text", text: input.question },
            { type: "image_url", image_url: { url: imageUrl } }
          ]
        : input.question;
    }

    return [{ role: "system", content: system }, ...history, { role: "user", content: userContent }];
  }

  private safeImageUrl(dataUrl?: string): string | undefined {
    try {
      return this.llm.validateImageDataUrl(dataUrl);
    } catch {
      // 图片无效时回退纯文本；answer() 的 fallback 不适用于纯文本追问，
      // 这里只在确实有图但图坏时降级为文本，让模型基于上下文回答。
      return undefined;
    }
  }

  private historyLimit(): number {
    // 从 config 取，避免循环依赖
    return Number.parseInt(process.env.MAX_CONTEXT_MESSAGES ?? "12", 10);
  }
}

/** 把内部 QA 历史映射为 LLM 上下文的 Message 形态。 */
export interface QaHistoryEntry {
  question: string;
  answer?: string;
}

export function toContextMessages(history: QaHistoryEntry[]): Message[] {
  const out: Message[] = [];
  for (const h of history) {
    out.push({ actor: "user", text: h.question, createdAt: "" });
    if (h.answer) out.push({ actor: "assistant", text: h.answer, createdAt: "" });
  }
  return out;
}
