/**
 * 学习报告生成（异步任务）。
 *
 * 强约束（产品要求）：报告必须基于实际拍到的证据。
 * 没拍到、看不清、无法判断的内容不能写成确定结论。
 *
 * 策略：把 session 的关键帧数量、QA 数量、已识别错题数等"事实"告诉模型，
 * 同时让模型只描述证据里确定存在的部分；不存在的部分明确标注"本次未拍到/无法判断"。
 */

import type { ErrorItem, Frame, QaTurn, ReportSection } from "@zpai/shared";
import type { LlmClient, LlmMessage } from "./llmClient.js";

export interface ReportContext {
  /** 关键帧摘要（数量 + reason 分布 + 已有 analysis） */
  keyFrames: Frame[];
  /** 本次 QA 提问 */
  qaTurns: QaTurn[];
  /** 本次疑似/已确认错题 */
  errorItems: ErrorItem[];
  /** 学生档案信息（年级、科目偏好，帮助模型措辞） */
  profile: { name: string; grade?: string; subjectFocus?: string };
  sessionStartedAt: string;
  sessionEndedAt?: string;
}
const SYSTEM_PROMPT = [
  "你是 zpai 的学习报告生成器，为家长/老师生成一份本次学习报告。",
  "最严格的要求：报告只能基于下面提供的实际证据（拍到的关键帧、学生的提问、已识别的错题）。",
  "证据里没有的内容，必须写'本次未拍到'或'无法判断'，绝不能编造题目、答案或错误。",
  "语气客观、简洁、有条理，用中文。每个章节用纯文本，不要 markdown 代码块。",
  "给家长/老师的建议要具体、可执行，且只针对证据里存在的问题。"
].join("\n");

/** 生成失败时的兜底报告（仍基于事实，不编造）。 */
export function fallbackReport(ctx: ReportContext): { sections: ReportSection[]; advice?: string } {
  const frameCount = ctx.keyFrames.length;
  const qaCount = ctx.qaTurns.length;
  const errCount = ctx.errorItems.length;
  return {
    sections: [
      {
        title: "本次学习概览",
        content: `本次学习记录到 ${frameCount} 个关键画面变化，学生提出了 ${qaCount} 个问题，初筛出 ${errCount} 条疑似错题待确认。${
          frameCount === 0 ? "本次未拍到有效的学习画面，无法进一步分析。" : ""
        }`
      },
      {
        title: "拍到的题目和作答情况",
        content:
          frameCount > 0
            ? `本次共记录 ${frameCount} 个关键帧（题目进入/书写/翻页/答案变化等）。详细题目识别需要逐帧确认，建议家长查看证据图。`
            : "本次未拍到清晰的学习材料，无法判断作答情况。"
      },
      {
        title: "学生问过的问题",
        content:
          qaCount > 0
            ? ctx.qaTurns.map((q, i) => `${i + 1}. ${q.questionText}`).join("\n")
            : "本次学生没有提出问题。"
      },
      {
        title: "需要复习的内容",
        content: errCount > 0 ? `有 ${errCount} 条疑似错题待确认，确认后进入复习队列。` : "本次未发现明显错题。"
      }
    ],
    advice:
      errCount > 0
        ? `建议家长/老师先确认 ${errCount} 条疑似错题是否为真实错误，确认后的错题系统会安排复习。`
        : "本次学习记录较少，建议确认设备摆放能拍到书本后再开始。"
  };
}

export class ReportGenerator {
  constructor(private readonly llm: LlmClient) {}

  async generate(ctx: ReportContext, signal?: AbortSignal): Promise<{ sections: ReportSection[]; advice?: string }> {
    // 没有任何证据时，直接返回兜底，不浪费模型调用
    if (ctx.keyFrames.length === 0 && ctx.qaTurns.length === 0 && ctx.errorItems.length === 0) {
      return fallbackReport(ctx);
    }

    try {
      const userPrompt = this.buildPrompt(ctx);
      const messages: LlmMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ];
      const raw = await this.llm.chat(messages, { temperature: 0.2, maxTokens: 1400, signal });
      return this.parseReport(raw, ctx);
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      return fallbackReport(ctx);
    }
  }

  private buildPrompt(ctx: ReportContext): string {
    const parts: string[] = [];
    parts.push(`学生：${ctx.profile.name}${ctx.profile.grade ? `（${ctx.profile.grade}）` : ""}`);
    parts.push(`学习时间：${ctx.sessionStartedAt} 至 ${ctx.sessionEndedAt ?? "进行中"}`);
    parts.push(`\n【证据1：关键帧 ${ctx.keyFrames.length} 个】`);
    if (ctx.keyFrames.length === 0) {
      parts.push("（本次未拍到有效关键帧）");
    } else {
      ctx.keyFrames.slice(0, 12).forEach((f, i) => {
        parts.push(`${i + 1}. ${reasonLabel(f.changeReason)}；${f.analysis ?? "暂无自动分析，需查看证据图"}`);
      });
      if (ctx.keyFrames.length > 12) parts.push(`...等共 ${ctx.keyFrames.length} 个`);
    }

    parts.push(`\n【证据2：学生提问 ${ctx.qaTurns.length} 条】`);
    if (ctx.qaTurns.length === 0) {
      parts.push("（本次学生未提问）");
    } else {
      ctx.qaTurns.slice(0, 20).forEach((q, i) => {
        const ans = q.answerText ? `；系统回答摘要：${q.answerText.slice(0, 60)}` : "";
        parts.push(`${i + 1}. 问：${q.questionText}${ans}`);
      });
    }

    parts.push(`\n【证据3：错题 ${ctx.errorItems.length} 条】`);
    if (ctx.errorItems.length === 0) {
      parts.push("（本次未识别出错题）");
    } else {
      ctx.errorItems.forEach((e, i) => {
        parts.push(`${i + 1}. ${e.subject ?? "未知科目"} 第${e.page ?? "?"}页 ${e.questionNo ?? "?"}题；类型：${e.errorType}；状态：${e.status}`);
      });
    }

    parts.push(
      "\n请基于以上证据生成报告，包含以下章节（每节一个标题+正文）：",
      "1. 本次学习大致内容",
      "2. 拍到的题目和作答情况",
      "3. 可能的错题",
      "4. 相关知识点",
      "5. 学生问过的问题",
      "6. 需要复习的内容",
      "最后另起一行写【给家长/老师的建议】。",
      "证据不足的章节如实写'本次未拍到/无法判断'，不要编造。"
    );
    return parts.join("\n");
  }

  /** 把模型的自然语言输出解析成结构化 sections。 */
  private parseReport(raw: string, ctx: ReportContext): { sections: ReportSection[]; advice?: string } {
    const lines = raw.split(/\r?\n/);
    const sections: ReportSection[] = [];
    let advice: string | undefined;
    let current: ReportSection | null = null;
    let inAdvice = false;
    const adviceBuf: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // 【给家长/老师的建议】标记
      if (/给家长\/?老师的?建议/.test(trimmed) || /^【?\s*给.*建议\s*】?$/.test(trimmed)) {
        inAdvice = true;
        if (current) {
          sections.push(current);
          current = null;
        }
        continue;
      }
      if (inAdvice) {
        if (trimmed) adviceBuf.push(trimmed);
        continue;
      }
      // 章节标题：以数字开头 "1. xxx" 或 "一、xxx" 或 "## xxx"
      const heading = /^(?:\d+[.、)\s]|一、|二、|三、|四、|五、|六、|七、|八、|#{1,3}\s+)(.+)$/.exec(trimmed);
      if (heading) {
        if (current) sections.push(current);
        current = { title: heading[1].replace(/^#+\s*/, "").trim(), content: "" };
      } else if (current) {
        current.content = current.content ? `${current.content}\n${line}` : line;
      }
    }
    if (current) sections.push(current);
    if (adviceBuf.length) advice = adviceBuf.join(" ");

    // 兜底：解析失败则用 fallback，保证不返回空
    if (sections.length === 0) {
      return fallbackReport(ctx);
    }
    return { sections, advice };
  }
}

function reasonLabel(reason: string): string {
  const map: Record<string, string> = {
    question_entered: "题目进入画面",
    writing_started: "开始书写",
    page_turned: "翻页",
    answer_changed: "答案变化",
    correction_appeared: "出现订正",
    long_stay: "长时间停留",
    manual: "手动抓拍"
  };
  return map[reason] ?? reason;
}
