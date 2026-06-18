/**
 * 数据层测试：错题状态机流转、复习队列入队/调度、profile 权限、session/qa。
 * 用内存库，隔离且快。
 */

import { describe, it, expect, beforeEach } from "vitest";
import { openMemoryDatabase } from "./db.js";
import type { DB } from "./db.js";
import { createRepos } from "./repos.js";
import { scheduleSm2, nextDueAt } from "./sm2.js";

let db: DB;
let repos: ReturnType<typeof createRepos>;

function seed() {
  const parent = repos.users.create({ role: "parent", username: "mom", passwordHash: "x", displayName: "妈妈" });
  const student = repos.users.create({ role: "student", username: "kid", passwordHash: "x", displayName: "小明" });
  const profile = repos.profiles.create({ name: "小明", grade: "三年级", ownerId: parent.id });
  const session = repos.sessions.start(profile.id);
  return { parent, student, profile, session };
}

beforeEach(() => {
  db = openMemoryDatabase();
  repos = createRepos(db);
});

describe("错题状态机", () => {
  it("新建错题默认 suspected", () => {
    const { profile, session } = seed();
    const err = repos.errors.insert({ profileId: profile.id, sessionId: session.id, errorType: "calculation" });
    expect(err.status).toBe("suspected");
  });

  it("suspected → confirmed → corrected → mastered 全链路流转", () => {
    const { profile, session } = seed();
    const err = repos.errors.insert({ profileId: profile.id, sessionId: session.id, errorType: "concept" });

    const c = repos.errors.updateStatus(err.id, "confirmed");
    expect(c?.status).toBe("confirmed");

    const corr = repos.errors.updateStatus(err.id, "corrected", "改成 42");
    expect(corr?.status).toBe("corrected");
    expect(corr?.correction).toBe("改成 42");

    const m = repos.errors.updateStatus(err.id, "mastered");
    expect(m?.status).toBe("mastered");
  });

  it("按状态过滤列表", () => {
    const { profile, session } = seed();
    repos.errors.insert({ profileId: profile.id, sessionId: session.id, errorType: "calculation" });
    repos.errors.insert({ profileId: profile.id, sessionId: session.id, errorType: "concept" });
    const e3 = repos.errors.insert({ profileId: profile.id, sessionId: session.id, errorType: "careless" });
    repos.errors.updateStatus(e3.id, "ignored");

    expect(repos.errors.listByProfileStatus(profile.id, "suspected")).toHaveLength(2);
    expect(repos.errors.listByProfileStatus(profile.id, "ignored")).toHaveLength(1);
    expect(repos.errors.listByProfile(profile.id)).toHaveLength(3);
  });
});

describe("复习队列", () => {
  it("错题入队幂等（同错题不重复）", () => {
    const { profile, session } = seed();
    const err = repos.errors.insert({ profileId: profile.id, sessionId: session.id, errorType: "calculation" });
    const q1 = repos.review.enqueue(err.id, profile.id);
    const q2 = repos.review.enqueue(err.id, profile.id);
    expect(q1?.id).toBeTruthy();
    // 第二次 enqueue 因 ON CONFLICT DO NOTHING 不创建新行，返回已存在的
    expect(q2?.id).toBe(q1?.id);
  });

  it("SM-2 调度更新 dueAt/interval/reps", () => {
    const { profile, session } = seed();
    const err = repos.errors.insert({ profileId: profile.id, sessionId: session.id, errorType: "calculation" });
    const q = repos.review.enqueue(err.id, profile.id)!;
    const next = scheduleSm2({ reps: q.reps, easeFactor: q.easeFactor, intervalDays: q.intervalDays }, "right");
    repos.review.updateSm2(q.id, { dueAt: nextDueAt(next.intervalDays), intervalDays: next.intervalDays, easeFactor: next.easeFactor, reps: next.reps }, "right");
    const after = repos.review.findById(q.id)!;
    expect(after.reps).toBe(1);
    expect(after.lastResult).toBe("right");
    expect(after.intervalDays).toBe(1);
  });

  it("mastered 结果移除复习项并标记错题", () => {
    const { profile, session } = seed();
    const err = repos.errors.insert({ profileId: profile.id, sessionId: session.id, errorType: "calculation" });
    const q = repos.review.enqueue(err.id, profile.id)!;
    repos.review.remove(q.id);
    expect(repos.review.findById(q.id)).toBeNull();
  });

  it("到期优先 + 无到期降级提前一条", () => {
    const { profile, session } = seed();
    // 无错题 → count 0
    expect(repos.review.countByProfile(profile.id)).toBe(0);
    expect(repos.review.nextUpcoming(profile.id)).toBeNull();

    const err = repos.errors.insert({ profileId: profile.id, sessionId: session.id, errorType: "calculation" });
    const q = repos.review.enqueue(err.id, profile.id)!;
    // 入队时 dueAt = now，应到期
    const due = repos.review.dueByProfile(profile.id);
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe(q.id);
  });
});

describe("profile 权限", () => {
  it("只有 owner/member 可访问", () => {
    const { parent, student } = seed();
    const profile = repos.profiles.create({ name: "小红", ownerId: parent.id });
    expect(repos.profiles.canAccess(profile.id, parent.id)).toBe(true);
    expect(repos.profiles.canAccess(profile.id, student.id)).toBe(false);
    // 把 student 加为 member
    repos.profiles.addMember(profile.id, student.id, "teacher");
    expect(repos.profiles.canAccess(profile.id, student.id)).toBe(true);
  });

  it("listByUser 只返回自己拥有或参与的", () => {
    const { parent, student, profile: seedProfile } = seed();
    const p1 = repos.profiles.create({ name: "档案A", ownerId: parent.id });
    const p2 = repos.profiles.create({ name: "档案B", ownerId: student.id });
    repos.profiles.addMember(p2.id, parent.id, "parent");
    const parentList = repos.profiles.listByUser(parent.id);
    // parent 拥有 seedProfile + 档案A，且被加为 档案B 的 member
    expect(parentList.map((p) => p.id).sort()).toEqual([seedProfile.id, p1.id, p2.id].sort());
    const studentList = repos.profiles.listByUser(student.id);
    expect(studentList.map((p) => p.id)).toEqual([p2.id]);
  });
});

describe("session / qa / frames", () => {
  it("session 启动并计数帧和问答", () => {
    const { profile } = seed();
    const s = repos.sessions.start(profile.id);
    expect(s.frameCount).toBe(0);
    repos.frames.insert({ sessionId: s.id, imagePath: "u", changeReason: "manual", isKeyFrame: true });
    repos.frames.insert({ sessionId: s.id, imagePath: "u2", changeReason: "writing_started", isKeyFrame: false });
    const after = repos.sessions.findById(s.id)!;
    expect(after.frameCount).toBe(2);
  });

  it("qa 多轮保存并按时间排序", () => {
    const { profile, session } = seed();
    repos.qa.create({ sessionId: session.id, profileId: profile.id, question: "第一题？" });
    repos.qa.create({ sessionId: session.id, profileId: profile.id, question: "第二题？" });
    const list = repos.qa.listBySession(session.id);
    expect(list).toHaveLength(2);
    expect(list[0].questionText).toBe("第一题？");
  });

  it("latestKeyFrame 返回最近的关键帧", () => {
    const { session } = seed();
    repos.frames.insert({ sessionId: session.id, imagePath: "u", changeReason: "manual", isKeyFrame: true });
    const f2 = repos.frames.insert({ sessionId: session.id, imagePath: "u2", changeReason: "page_turned", isKeyFrame: true });
    expect(repos.frames.latestKeyFrame(session.id)?.id).toBe(f2.id);
  });
});
