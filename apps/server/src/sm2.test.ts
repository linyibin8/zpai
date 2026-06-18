/**
 * SM-2 间隔重复算法测试。
 * 验证四种复习结果对间隔、EF、reps 的影响，以及 mastered 的移除标记。
 */

import { describe, it, expect } from "vitest";
import { scheduleSm2, nextDueAt } from "./sm2.js";

const base = { reps: 0, easeFactor: 2.5, intervalDays: 1 };

describe("scheduleSm2", () => {
  it("right 第一次：reps=1，间隔 1 天", () => {
    const r = scheduleSm2(base, "right");
    expect(r.reps).toBe(1);
    expect(r.intervalDays).toBe(1);
    expect(r.mastered).toBe(false);
  });

  it("right 第二次：间隔 6 天", () => {
    const r = scheduleSm2({ ...base, reps: 1, intervalDays: 1 }, "right");
    expect(r.reps).toBe(2);
    expect(r.intervalDays).toBe(6);
  });

  it("right 第三次起：间隔 = round(prevInterval * EF)", () => {
    const r = scheduleSm2({ reps: 2, easeFactor: 2.6, intervalDays: 6 }, "right");
    expect(r.reps).toBe(3);
    expect(r.intervalDays).toBe(Math.round(6 * 2.6)); // 16
  });

  it("wrong：reps 重置为 0，间隔回到 1 天，EF 降低", () => {
    const r = scheduleSm2({ reps: 3, easeFactor: 2.5, intervalDays: 15 }, "wrong");
    expect(r.reps).toBe(0);
    expect(r.intervalDays).toBe(1);
    expect(r.easeFactor).toBeLessThan(2.5);
    expect(r.easeFactor).toBeGreaterThanOrEqual(1.3);
  });

  it("later：EF 略降，间隔小幅增长", () => {
    const r = scheduleSm2({ reps: 1, easeFactor: 2.5, intervalDays: 2 }, "later");
    expect(r.reps).toBe(2);
    expect(r.intervalDays).toBeGreaterThanOrEqual(1);
    expect(r.easeFactor).toBeLessThanOrEqual(2.5);
  });

  it("mastered：标记移除，间隔很长", () => {
    const r = scheduleSm2({ reps: 2, easeFactor: 2.5, intervalDays: 6 }, "mastered");
    expect(r.mastered).toBe(true);
    expect(r.intervalDays).toBe(180);
  });

  it("EF 下限不低于 1.3", () => {
    // 连续多次 wrong 不应跌破 1.3
    let state = { ...base };
    for (let i = 0; i < 20; i++) state = scheduleSm2(state, "wrong");
    expect(state.easeFactor).toBeGreaterThanOrEqual(1.3);
  });
});

describe("nextDueAt", () => {
  it("返回的是未来时间，间隔正确", () => {
    const from = new Date("2026-06-18T00:00:00Z");
    const due = new Date(nextDueAt(7, from));
    const diffDays = (due.getTime() - from.getTime()) / (24 * 3600 * 1000);
    expect(diffDays).toBeCloseTo(7, 1);
  });
});
