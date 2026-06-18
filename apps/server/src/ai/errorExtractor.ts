/**
 * 错题抽取（异步任务）。
 *
 * 对一个关键帧调用模型，判断是否含疑似错题；含则输出结构化候选。
 * 抽取出的错题入库为 suspected，附证据帧，供家长/老师确认。
 *
 * 原则：只对"看到答案且明显错误"的情况抽取；看不清/无作答时返回空，不编造。
 */

import type { ErrorType } from "@zpai/shared";
import type { LlmClient, LlmMessage } from "./llmClient.js";

export interface ExtractInput {
  imageDataUrl: string;
  subject?: string;
}

export interface ExtractedError {
  page?: number;
  questionNo?: string;
  errorType: ErrorType;
  knowledgePoints?: string[];
  /** 模型描述的错因 */
  reason?: string;
  /** 建议的订正方向 */
  correction?: string;
}

const SYSTEM_PROMPT = [
  "你是 zpai 的错题识别助手。任务是：看一张学生学习画面的照片，判断其中是否有'看起来做错了'的题目。",
  "只输出确实能看到答案、且答案明显错误（计算错误/概念错误/方法错误/粗心）的题目。",
  "如果画面不清晰、没有作答、或答案看起来正确，就不要抽取，返回空数组。",
  "绝不能编造题目或答案。看不清就当没看到。",
  "输出严格的 JSON 数组，每个元素：{page, question_no, error_type, knowledge_points, reason, correction}。",
  "error_type 只能是: calculation(计算错误)/concept(概念错误)/method(方法错误)/careless(粗心)/unknown(待定)。",
  "如果没有错题，只输出 []。不要输出任何解释文字。"
].join("\n");

export class ErrorExtractor {
  constructor(private readonly llm: LlmClient) {}

  async extract(input: ExtractInput, signal?: AbortSignal): Promise<ExtractedError[]> {
    let imageUrl: string | undefined;
    try {
      imageUrl = this.llm.validateImageDataUrl(input.imageDataUrl);
    } catch {
      return [];
    }
    if (!imageUrl) return [];

    const messages: LlmMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: `科目：${input.subject ?? "未指定"}。请识别这张照片里的疑似错题，只输出 JSON 数组。` },
          { type: "image_url", image_url: { url: imageUrl } }
        ]
      }
    ];

    try {
      const raw = await this.llm.chat(messages, { temperature: 0.1, maxTokens: 700, signal });
      return this.parse(raw);
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      return [];
    }
  }

  /** 从模型输出里解析 JSON 数组；容错处理各种格式偏差。 */
  private parse(raw: string): ExtractedError[] {
    const jsonText = extractJsonArray(raw);
    if (!jsonText) return [];
    try {
      const arr = JSON.parse(jsonText) as unknown;
      if (!Array.isArray(arr)) return [];
      const validTypes = new Set<ErrorType>(["calculation", "concept", "method", "careless", "unknown"]);
      return arr
        .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
        .map((x) => normalizeExtracted(x, validTypes))
        .filter((x): x is ExtractedError => x !== null);
    } catch {
      return [];
    }
  }
}

function extractJsonArray(raw: string): string | null {
  const trimmed = raw.trim();
  // 去掉 markdown 代码围栏
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

function normalizeExtracted(
  x: Record<string, unknown>,
  validTypes: Set<ErrorType>
): ExtractedError | null {
  const rawType = String(x.error_type ?? x.errorType ?? "unknown").toLowerCase();
  const errorType: ErrorType = validTypes.has(rawType as ErrorType) ? (rawType as ErrorType) : "unknown";
  const out: ExtractedError = { errorType };

  if (typeof x.page === "number") out.page = x.page;
  else if (typeof x.page === "string" && /^\d+$/.test(x.page)) out.page = Number(x.page);

  const qno = x.question_no ?? x.questionNo;
  if (typeof qno === "string" && qno.trim()) out.questionNo = qno.trim();
  else if (typeof qno === "number") out.questionNo = String(qno);

  const kpRaw = (x.knowledge_points ?? x.knowledgePoints) as unknown;
  if (Array.isArray(kpRaw)) {
    out.knowledgePoints = (kpRaw as unknown[])
      .map((k) => String(k))
      .filter((k) => k.length);
  }
  if (typeof x.reason === "string" && x.reason.trim()) out.reason = x.reason.trim();
  if (typeof x.correction === "string" && x.correction.trim()) out.correction = x.correction.trim();

  return out;
}
