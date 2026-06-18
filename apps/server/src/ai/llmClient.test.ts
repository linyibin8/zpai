/**
 * LLM 客户端测试：图片校验、enable_thinking 参数、错误 fallback。
 * 用 mock fetch，不依赖真实模型。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LlmClient } from "./llmClient.js";

const baseConfig = {
  port: 8787,
  consoleOrigin: "http://x",
  publicBaseUrl: "http://x",
  dataDir: "./data",
  uploadDir: "./uploads",
  jwtSecret: "test",
  jwtTtlDays: 1,
  llmBaseUrl: "http://llm.test/v1",
  llmApiKey: "k",
  llmModel: "test-model",
  llmDisableThinking: true,
  maxImageChars: 1000,
  maxContextMessages: 12,
  taskConcurrency: 1
};

function makeClient(fetchImpl: typeof fetch) {
  return new LlmClient(fetchImpl, baseConfig);
}

describe("LlmClient.validateImageDataUrl", () => {
  const client = makeClient(async () => new Response("{}"));
  const ok = "data:image/jpeg;base64," + "a".repeat(50);

  it("接受合法 jpeg data url", () => {
    expect(client.validateImageDataUrl(ok)).toBe(ok);
  });
  it("接受 png / webp", () => {
    expect(client.validateImageDataUrl("data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA");
    expect(client.validateImageDataUrl("data:image/webp;base64,AAA")).toBe("data:image/webp;base64,AAA");
  });
  it("拒绝非法格式", () => {
    expect(() => client.validateImageDataUrl("http://x/a.jpg")).toThrow();
    expect(() => client.validateImageDataUrl("data:application/pdf;base64,AAA")).toThrow();
  });
  it("拒绝超限图片", () => {
    const big = "data:image/jpeg;base64," + "a".repeat(2000);
    expect(() => client.validateImageDataUrl(big)).toThrow(/too large/i);
  });
  it("空值返回 undefined（不抛错）", () => {
    expect(client.validateImageDataUrl(undefined)).toBeUndefined();
  });
});

describe("LlmClient.chat", () => {
  it("请求体含 enable_thinking=false", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "你好" } }] }), {
        headers: { "content-type": "application/json" }
      })
    );
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await client.chat([{ role: "user", content: "hi" }]);
    const call = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(call[1].body as string);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body.stream).toBe(false);
    expect(body.model).toBe("test-model");
  });

  it("优先返回 message.content", async () => {
    const client = makeClient(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "答案", reasoning_content: "思考" } }] }))
    );
    expect(await client.chat([{ role: "user", content: "x" }])).toBe("答案");
  });

  it("content 为空时回退 reasoning_content", async () => {
    const client = makeClient(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: null, reasoning_content: "兜底" } }] }))
    );
    expect(await client.chat([{ role: "user", content: "x" }])).toBe("兜底");
  });

  it("两者都空抛错", async () => {
    const client = makeClient(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }))
    );
    await expect(client.chat([{ role: "user", content: "x" }])).rejects.toThrow(/empty answer/i);
  });

  it("HTTP 非 2xx 抛错", async () => {
    const client = makeClient(async () => new Response("boom", { status: 500 }));
    await expect(client.chat([{ role: "user", content: "x" }])).rejects.toThrow(/500/);
  });
});
