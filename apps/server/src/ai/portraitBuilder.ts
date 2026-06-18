/**
 * 长期学习画像构建。
 *
 * 聚合一个 profile 的：错题（知识点/错误类型/科目分布）、最近 session 摘要、
 * 复习情况、常被追问的问题。先用纯数据聚合（不依赖模型），保证稳定可用。
 */

import type { DB } from "../db.js";
import type { ErrorType, ProfilePortrait } from "@zpai/shared";
import { decodeJson } from "../util.js";
import { nowIso } from "../util.js";

interface AggregatedRow {
  subject: string | null;
  error_type: string;
  knowledge_points: string | null;
  status: string;
}

interface QaRow {
  question_text: string;
  status: string;
}

interface SessionRow {
  summary: string | null;
  started_at: string;
  ended_at: string | null;
}

export class PortraitBuilder {
  constructor(private readonly db: DB) {}

  build(profileId: string): Omit<ProfilePortrait, "profileId" | "updatedAt"> {
    const errors = this.db
      .prepare<unknown, AggregatedRow>(`SELECT subject, error_type, knowledge_points, status FROM error_items WHERE profile_id = ?`)
      .all(profileId);

    // 知识点频次
    const kpCount = new Map<string, number>();
    const typeCount: Record<string, number> = {};
    const subjCount: Record<string, number> = {};
    for (const e of errors) {
      const kps = decodeJson<string[]>(e.knowledge_points, []);
      for (const k of kps) kpCount.set(k, (kpCount.get(k) ?? 0) + 1);
      typeCount[e.error_type] = (typeCount[e.error_type] ?? 0) + 1;
      const subj = e.subject ?? "未知科目";
      subjCount[subj] = (subjCount[subj] ?? 0) + 1;
    }
    // 薄弱知识点：频次最高
    const weakPoints = [...kpCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k]) => k);

    // 错误类型分布（补齐所有枚举为 0）
    const errorTypes = this.fillErrorTypes(typeCount);

    // 最近 session 摘要
    const recentSessions = this.db
      .prepare<unknown, SessionRow>(`SELECT summary, started_at, ended_at FROM sessions WHERE profile_id = ? ORDER BY started_at DESC LIMIT 5`)
      .all(profileId);
    const recentSummary = recentSessions
      .map((s, i) => {
        const text = s.summary ?? "（无摘要）";
        return `${i + 1}. ${s.started_at.slice(0, 10)}：${text.slice(0, 80)}`;
      })
      .join("\n");

    // 复习情况
    const reviewStats = this.db
      .prepare<unknown, { last_result: string | null }>(
        `SELECT last_result FROM review_queue WHERE profile_id = ?`
      )
      .all(profileId);
    const reviewSummary = this.summarizeReview(reviewStats.map((r) => r.last_result));

    // 常被追问的问题：QA 里出现频次高的提问（简单按文本分组）
    const qas = this.db
      .prepare<unknown, QaRow>(`SELECT question_text, status FROM qa_turns WHERE profile_id = ? ORDER BY created_at DESC LIMIT 100`)
      .all(profileId);
    const frequentQuestions = this.frequentQuestions(qas.map((q) => q.question_text));

    return {
      weakPoints,
      errorTypes,
      subjectDist: subjCount,
      recentSummary: recentSummary || undefined,
      reviewSummary,
      frequentQuestions
    };
  }

  private fillErrorTypes(counts: Record<string, number>): Record<ErrorType, number> {
    const base: Record<ErrorType, number> = {
      calculation: 0,
      concept: 0,
      careless: 0,
      method: 0,
      unknown: 0
    };
    for (const [k, v] of Object.entries(counts)) {
      if (k in base) base[k as ErrorType] = v;
      else base.unknown += v;
    }
    return base;
  }

  private summarizeReview(results: (string | null)[]): string {
    const total = results.length;
    if (total === 0) return "暂无复习记录。";
    const right = results.filter((r) => r === "right").length;
    const wrong = results.filter((r) => r === "wrong").length;
    const mastered = results.filter((r) => r === "mastered").length;
    return `复习 ${total} 次：正确 ${right} 次、仍错 ${wrong} 次、已掌握 ${mastered} 项。`;
  }

  private frequentQuestions(questions: string[]): string[] {
    const count = new Map<string, number>();
    for (const q of questions) {
      const key = q.slice(0, 30);
      count.set(key, (count.get(key) ?? 0) + 1);
    }
    return [...count.entries()]
      .filter(([, c]) => c >= 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k]) => k);
  }
}

/** 便捷函数：构建并返回完整 ProfilePortrait。 */
export function buildPortraitNow(builder: PortraitBuilder, profileId: string): ProfilePortrait {
  return { profileId, updatedAt: nowIso(), ...builder.build(profileId) };
}
