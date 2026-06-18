/**
 * 报告生成器测试：强约束（无证据不编造）、fallback、章节解析。
 */

import { describe, it, expect, vi } from "vitest";
import { ReportGenerator, fallbackReport } from "./reportGenerator.js";
import type { LlmClient } from "./llmClient.js";
import type { ReportContext } from "./reportGenerator.js";

function makeGen(reply: string): ReportGenerator {
  const llm = { validateImageDataUrl: () => undefined, chat: async () => reply } as unknown as LlmClient;
  return new ReportGenerator(llm);
}

const emptyCtx: ReportContext = {
  keyFrames: [],
  qaTurns: [],
  errorItems: [],
  profile: { name: "小明" },
  sessionStartedAt: "2026-06-18T10:00:00Z"
};

describe("ReportGenerator", () => {
  it("无任何证据时不调用模型，返回 fallback", async () => {
    const chat = vi.fn(async () => "should not be called");
    const llm = { validateImageDataUrl: () => undefined, chat } as unknown as LlmClient;
    const gen = new ReportGenerator(llm);
    const res = await gen.generate(emptyCtx);
    expect(chat).not.toHaveBeenCalled();
    expect(res.sections.length).toBeGreaterThan(0);
    // 必须如实说明未拍到
    const allText = res.sections.map((s) => s.content).join("\n");
    expect(allText).toMatch(/未拍到|未发现|没有/);
  });

  it("解析模型输出为结构化章节", async () => {
    const reply = [
      "1. 本次学习大致内容",
      "学习了两位数加法。",
      "2. 拍到的题目和作答情况",
      "拍到第1页第3题，答案为 17。",
      "3. 可能的错题",
      "第3题计算错误。",
      "4. 相关知识点",
      "进位加法。",
      "5. 学生问过的问题",
      "第三题怎么做？",
      "6. 需要复习的内容",
      "进位加法。",
      "【给家长/老师的建议】",
      "建议每天练习 5 道进位加法。"
    ].join("\n");
    const gen = makeGen(reply);
    const ctx: ReportContext = {
      keyFrames: [{ id: "f1", sessionId: "s", capturedAt: "t", imageUrl: "u", changeReason: "question_entered", isKeyFrame: true }],
      qaTurns: [{ id: "q1", sessionId: "s", profileId: "p", questionText: "第三题怎么做？", status: "answered", createdAt: "t" }],
      errorItems: [],
      profile: { name: "小明" },
      sessionStartedAt: "t"
    };
    const res = await gen.generate(ctx);
    expect(res.sections.length).toBe(6);
    expect(res.sections[0].title).toContain("学习大致内容");
    expect(res.advice).toContain("进位加法");
  });

  it("模型异常时回退 fallback（不抛错）", async () => {
    const llm = { validateImageDataUrl: () => undefined, chat: async () => { throw new Error("model down"); } } as unknown as LlmClient;
    const gen = new ReportGenerator(llm);
    const ctx: ReportContext = {
      keyFrames: [{ id: "f1", sessionId: "s", capturedAt: "t", imageUrl: "u", changeReason: "manual", isKeyFrame: true }],
      qaTurns: [],
      errorItems: [],
      profile: { name: "小明" },
      sessionStartedAt: "t"
    };
    const res = await gen.generate(ctx);
    expect(res.sections.length).toBeGreaterThan(0);
  });
});

describe("fallbackReport", () => {
  it("如实反映证据数量", () => {
    const res = fallbackReport({ ...emptyCtx, keyFrames: [{ id: "f1", sessionId: "s", capturedAt: "t", imageUrl: "u", changeReason: "manual", isKeyFrame: true }] as ReportContext["keyFrames"] });
    const overview = res.sections[0].content;
    expect(overview).toContain("1");
  });
});
