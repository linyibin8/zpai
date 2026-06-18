/**
 * 错题抽取器测试：JSON 解析容错、空结果、格式归一化。
 */

import { describe, it, expect } from "vitest";
import { ErrorExtractor } from "./errorExtractor.js";
import type { LlmClient } from "./llmClient.js";

const okImage = "data:image/jpeg;base64," + "a".repeat(20);

function makeExtractor(reply: string): ErrorExtractor {
  const llm = {
    validateImageDataUrl: (d?: string) => d,
    chat: async () => reply
  } as unknown as LlmClient;
  return new ErrorExtractor(llm);
}

describe("ErrorExtractor.extract", () => {
  it("解析裸 JSON 数组", async () => {
    const ext = makeExtractor(
      JSON.stringify([
        { page: 1, question_no: "3", error_type: "calculation", knowledge_points: ["进位加法"], reason: "忘进位", correction: "补上进位" }
      ])
    );
    const out = await ext.extract({ imageDataUrl: okImage });
    expect(out).toHaveLength(1);
    expect(out[0].errorType).toBe("calculation");
    expect(out[0].page).toBe(1);
    expect(out[0].questionNo).toBe("3");
    expect(out[0].knowledgePoints).toEqual(["进位加法"]);
  });

  it("解析带 markdown 代码围栏的 JSON", async () => {
    const ext = makeExtractor("```json\n[{\"error_type\":\"concept\",\"question_no\":\"5\"}]\n```");
    const out = await ext.extract({ imageDataUrl: okImage });
    expect(out).toHaveLength(1);
    expect(out[0].errorType).toBe("concept");
    expect(out[0].questionNo).toBe("5");
  });

  it("解析模型输出前后带解释文字", async () => {
    const ext = makeExtractor('识别到以下错题：\n[{"error_type":"careless"}]\n以上结果。');
    const out = await ext.extract({ imageDataUrl: okImage });
    expect(out).toHaveLength(1);
    expect(out[0].errorType).toBe("careless");
  });

  it("空数组返回空", async () => {
    const ext = makeExtractor("[]");
    expect(await ext.extract({ imageDataUrl: okImage })).toEqual([]);
  });

  it("无效 JSON 返回空（不抛错）", async () => {
    const ext = makeExtractor("这不是JSON");
    expect(await ext.extract({ imageDataUrl: okImage })).toEqual([]);
  });

  it("未知 error_type 归为 unknown", async () => {
    const ext = makeExtractor('[{"error_type":"typo_of_some_kind"}]');
    const out = await ext.extract({ imageDataUrl: okImage });
    expect(out[0].errorType).toBe("unknown");
  });

  it("非法图片 data url 返回空", async () => {
    const ext = makeExtractor("[]");
    // 用真实的 client 让 validate 抛错
    const badLlm = {
      validateImageDataUrl: () => {
        throw new Error("bad");
      },
      chat: async () => "[]"
    } as unknown as LlmClient;
    const ext2 = new ErrorExtractor(badLlm);
    expect(await ext2.extract({ imageDataUrl: "not-a-data-url" })).toEqual([]);
  });
});
