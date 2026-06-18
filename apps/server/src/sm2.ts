/**
 * SM-2 间隔重复算法（SuperMemo 2 简化版）。
 *
 * 用 4 档复习结果映射到 SM-2 的 quality：
 *   right   → q=5（完美）
 *   wrong   → q=2（失败，重置间隔）
 *   later   → q=3（模糊，间隔略增但不升 ease）
 *   mastered → 视为掌握，直接长间隔并提示可移出队列
 *
 * 返回下一次复习调度参数。
 */

import type { ReviewResult } from "@zpai/shared";

export interface Sm2Input {
  reps: number; // 已复习次数
  easeFactor: number; // 当前 EF
  intervalDays: number; // 当前间隔
}

export interface Sm2Output {
  reps: number;
  easeFactor: number;
  intervalDays: number;
  /** 掌握：建议从复习队列移除。 */
  mastered: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 把 SM-2 调度结果转成下一次到期的 ISO 时间。 */
export function nextDueAt(intervalDays: number, from: Date = new Date()): string {
  return new Date(from.getTime() + intervalDays * DAY_MS).toISOString();
}

export function scheduleSm2(input: Sm2Input, result: ReviewResult): Sm2Output {
  const ef = Math.max(1.3, input.easeFactor);
  let reps = input.reps;
  let easeFactor = ef;
  let intervalDays: number;
  let mastered = false;

  switch (result) {
    case "right": {
      // q=5
      reps += 1;
      easeFactor = clampEf(ef + (0.1 - (5 - 5) * (0.08 + (5 - 5) * 0.02)));
      intervalDays = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(input.intervalDays * easeFactor);
      break;
    }
    case "later": {
      // q=3，勉强
      reps += 1;
      // q=3 时 EF 略降
      easeFactor = clampEf(ef + (0.1 - (5 - 3) * (0.08 + (5 - 3) * 0.02)));
      intervalDays = reps === 1 ? 1 : Math.max(1, Math.round(input.intervalDays * 1.2));
      break;
    }
    case "wrong": {
      // q=2，失败：重置 reps，间隔回到 1 天，EF 降低
      reps = 0;
      easeFactor = clampEf(ef - 0.2);
      intervalDays = 1;
      break;
    }
    case "mastered": {
      // 已掌握：给一个很长间隔并标记移除
      mastered = true;
      reps += 1;
      intervalDays = 180; // 半年后兜底
      break;
    }
    default: {
      const _exhaustive: never = result;
      throw new Error(`Unknown review result: ${String(_exhaustive)}`);
    }
  }

  return { reps, easeFactor, intervalDays, mastered };
}

function clampEf(v: number): number {
  return Math.max(1.3, Math.round(v * 100) / 100);
}
