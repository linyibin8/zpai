/**
 * 数据访问层：封装各表的 SQL。
 * 每个 repo 接收 DB 实例，方法返回已映射的领域对象。
 * 行对象 → 共享类型 的映射集中在这里，路由层只处理 HTTP。
 */

import type {
  ErrorItem,
  ErrorStatus,
  ErrorType,
  Frame,
  FrameChangeReason,
  Profile,
  ProfileMember,
  ProfilePortrait,
  QaTurn,
  Report,
  ReviewQueueItem,
  ReviewResult,
  Session,
  User,
  UserRole,
  BoundingBox
} from "@zpai/shared";
import type { DB } from "./db.js";
import { decodeJson, encodeJson, newId, nowIso, truthy } from "./util.js";
import { PortraitBuilder } from "./ai/portraitBuilder.js";

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  role: string;
  username: string;
  password_hash: string;
  display_name: string;
  created_at: string;
}

export function mapUser(row: UserRow): User {
  return {
    id: row.id,
    role: row.role as UserRole,
    username: row.username,
    displayName: row.display_name,
    createdAt: row.created_at
  };
}

export function createUserRepo(db: DB) {
  const stmts = {
    insert: db.prepare<
      [string, string, string, string, string]
    >(`INSERT INTO users (id, role, username, password_hash, display_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`),
    findByUsername: db.prepare<string, UserRow>(`SELECT * FROM users WHERE username = ?`),
    findById: db.prepare<string, UserRow>(`SELECT * FROM users WHERE id = ?`)
  };

  return {
    create(input: { role: UserRole; username: string; passwordHash: string; displayName: string }): User {
      const id = newId("usr");
      const now = nowIso();
      stmts.insert.run(id, input.role, input.username, input.passwordHash, input.displayName, now);
      return { id, role: input.role, username: input.username, displayName: input.displayName, createdAt: now };
    },
    findByUsername(username: string) {
      const row = stmts.findByUsername.get(username);
      return row ? { user: mapUser(row), passwordHash: row.password_hash } : null;
    },
    findById(id: string): User | null {
      const row = stmts.findById.get(id);
      return row ? mapUser(row) : null;
    }
  };
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

interface ProfileRow {
  id: string;
  name: string;
  grade: string | null;
  subject_focus: string | null;
  owner_id: string;
  created_at: string;
}

function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    name: row.name,
    grade: row.grade ?? undefined,
    subjectFocus: row.subject_focus ?? undefined,
    ownerId: row.owner_id,
    createdAt: row.created_at
  };
}

export function createProfileRepo(db: DB) {
  const stmts = {
    insert: db.prepare<
      [string, string, string | null, string | null, string, string]
    >(`INSERT INTO profiles (id, name, grade, subject_focus, owner_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`),
    findById: db.prepare<string, ProfileRow>(`SELECT * FROM profiles WHERE id = ?`),
    listByUser: db.prepare<string, ProfileRow>(
      `SELECT p.* FROM profiles p
       LEFT JOIN profile_members m ON m.profile_id = p.id
       WHERE p.owner_id = ? OR m.user_id = ?
       GROUP BY p.id
       ORDER BY p.created_at DESC`
    ),
    addMember: db.prepare<[string, string, string]>(
      `INSERT OR IGNORE INTO profile_members (profile_id, user_id, role) VALUES (?, ?, ?)`
    ),
    listMembers: db.prepare<
      string,
      { user_id: string; role: string; display_name: string }
    >(
      `SELECT m.user_id, m.role, u.display_name FROM profile_members m
       JOIN users u ON u.id = m.user_id WHERE m.profile_id = ?`
    ),
    isMember: db.prepare<
      [string, string],
      { role: string }
    >(`SELECT role FROM profile_members WHERE profile_id = ? AND user_id = ?`),
    isOwner: db.prepare<[string, string], { owner_id: string }>(
      `SELECT owner_id FROM profiles WHERE id = ?`
    )
  };

  return {
    create(input: { name: string; grade?: string; subjectFocus?: string; ownerId: string }): Profile {
      const id = newId("prof");
      const now = nowIso();
      stmts.insert.run(id, input.name, input.grade ?? null, input.subjectFocus ?? null, input.ownerId, now);
      stmts.addMember.run(id, input.ownerId, "owner");
      return {
        id,
        name: input.name,
        grade: input.grade,
        subjectFocus: input.subjectFocus,
        ownerId: input.ownerId,
        createdAt: now
      };
    },
    findById(id: string): Profile | null {
      const row = stmts.findById.get(id);
      return row ? mapProfile(row) : null;
    },
    listByUser(userId: string): Profile[] {
      return stmts.listByUser.all(userId, userId).map(mapProfile);
    },
    /** 当前用户对该档案的可见角色；无权限返回 null。 */
    roleOf(profileId: string, userId: string): "owner" | "parent" | "teacher" | null {
      const member = stmts.isMember.get(profileId, userId);
      if (member) return member.role as "owner" | "parent" | "teacher";
      return null;
    },
    canAccess(profileId: string, userId: string): boolean {
      return this.roleOf(profileId, userId) !== null;
    },
    addMember(profileId: string, userId: string, role: "parent" | "teacher"): void {
      stmts.addMember.run(profileId, userId, role);
    },
    listMembers(profileId: string): ProfileMember[] {
      return stmts.listMembers.all(profileId).map((r) => ({
        profileId,
        userId: r.user_id,
        role: r.role as ProfileMember["role"],
        displayName: r.display_name
      }));
    }
  };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string;
  profile_id: string;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  frame_count: number;
  qa_count: number;
}

function mapSession(row: SessionRow): Session {
  return {
    id: row.id,
    profileId: row.profile_id,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    summary: row.summary ?? undefined,
    frameCount: row.frame_count,
    qaCount: row.qa_count
  };
}

export function createSessionRepo(db: DB) {
  const stmts = {
    insert: db.prepare<[string, string, string]>(
      `INSERT INTO sessions (id, profile_id, started_at) VALUES (?, ?, ?)`
    ),
    findById: db.prepare<string, SessionRow>(
      `SELECT s.*,
         (SELECT COUNT(*) FROM frames WHERE session_id = s.id) AS frame_count,
         (SELECT COUNT(*) FROM qa_turns WHERE session_id = s.id) AS qa_count
       FROM sessions s WHERE s.id = ?`
    ),
    listByProfile: db.prepare<string, SessionRow>(
      `SELECT s.*,
         (SELECT COUNT(*) FROM frames WHERE session_id = s.id) AS frame_count,
         (SELECT COUNT(*) FROM qa_turns WHERE session_id = s.id) AS qa_count
       FROM sessions s WHERE s.profile_id = ? ORDER BY s.started_at DESC`
    ),
    endSession: db.prepare<[string, string | null, string]>(
      `UPDATE sessions SET ended_at = ?, summary = ? WHERE id = ?`
    )
  };

  return {
    start(profileId: string): Session {
      const id = newId("sess");
      const now = nowIso();
      stmts.insert.run(id, profileId, now);
      return { id, profileId, startedAt: now, frameCount: 0, qaCount: 0 };
    },
    findById(id: string): Session | null {
      const row = stmts.findById.get(id);
      return row ? mapSession(row) : null;
    },
    listByProfile(profileId: string): Session[] {
      return stmts.listByProfile.all(profileId).map(mapSession);
    },
    end(id: string, summary?: string): void {
      stmts.endSession.run(nowIso(), summary ?? null, id);
    }
  };
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

interface FrameRow {
  id: string;
  session_id: string;
  captured_at: string;
  image_path: string;
  change_reason: string;
  is_key_frame: number;
  analysis: string | null;
}

export function mapFrame(row: FrameRow): Frame {
  return {
    id: row.id,
    sessionId: row.session_id,
    capturedAt: row.captured_at,
    imageUrl: row.image_path,
    changeReason: row.change_reason as FrameChangeReason,
    isKeyFrame: row.is_key_frame === 1,
    analysis: row.analysis ?? undefined
  };
}

export function createFrameRepo(db: DB) {
  const stmts = {
    insert: db.prepare<
      [string, string, string, string, string, number, string | null]
    >(`INSERT INTO frames (id, session_id, captured_at, image_path, change_reason, is_key_frame, analysis)
       VALUES (?, ?, ?, ?, ?, ?, ?)`),
    findById: db.prepare<string, FrameRow>(`SELECT * FROM frames WHERE id = ?`),
    listBySession: db.prepare<string, FrameRow>(
      `SELECT * FROM frames WHERE session_id = ? ORDER BY captured_at ASC`
    ),
    listKeyFrames: db.prepare<string, FrameRow>(
      `SELECT * FROM frames WHERE session_id = ? AND is_key_frame = 1 ORDER BY captured_at ASC`
    ),
    setAnalysis: db.prepare<[string, string]>(`UPDATE frames SET analysis = ? WHERE id = ?`),
    latestKeyFrame: db.prepare<string, FrameRow>(
      `SELECT * FROM frames WHERE session_id = ? AND is_key_frame = 1 ORDER BY captured_at DESC LIMIT 1`
    )
  };

  return {
    insert(input: {
      sessionId: string;
      imagePath: string;
      changeReason: FrameChangeReason;
      isKeyFrame: boolean;
      capturedAt?: string;
      analysis?: string;
    }): Frame {
      const id = newId("frm");
      const capturedAt = input.capturedAt ?? nowIso();
      stmts.insert.run(
        id,
        input.sessionId,
        capturedAt,
        input.imagePath,
        input.changeReason,
        input.isKeyFrame ? 1 : 0,
        input.analysis ?? null
      );
      return {
        id,
        sessionId: input.sessionId,
        capturedAt,
        imageUrl: input.imagePath,
        changeReason: input.changeReason,
        isKeyFrame: input.isKeyFrame,
        analysis: input.analysis
      };
    },
    findById(id: string): Frame | null {
      const row = stmts.findById.get(id);
      return row ? mapFrame(row) : null;
    },
    listBySession(sessionId: string): Frame[] {
      return stmts.listBySession.all(sessionId).map(mapFrame);
    },
    listKeyFrames(sessionId: string): Frame[] {
      return stmts.listKeyFrames.all(sessionId).map(mapFrame);
    },
    setAnalysis(id: string, analysis: string): void {
      stmts.setAnalysis.run(analysis, id);
    },
    latestKeyFrame(sessionId: string): Frame | null {
      const row = stmts.latestKeyFrame.get(sessionId);
      return row ? mapFrame(row) : null;
    }
  };
}

// ---------------------------------------------------------------------------
// QA turns
// ---------------------------------------------------------------------------

interface QaRow {
  id: string;
  session_id: string;
  profile_id: string;
  question_text: string;
  frame_id: string | null;
  answer_text: string | null;
  status: string;
  created_at: string;
}

function mapQa(row: QaRow): QaTurn {
  return {
    id: row.id,
    sessionId: row.session_id,
    profileId: row.profile_id,
    questionText: row.question_text,
    frameId: row.frame_id ?? undefined,
    answerText: row.answer_text ?? undefined,
    status: row.status as QaTurn["status"],
    createdAt: row.created_at
  };
}

export function createQaRepo(db: DB) {
  const stmts = {
    insert: db.prepare<
      [string, string, string, string, string | null, string]
    >(`INSERT INTO qa_turns (id, session_id, profile_id, question_text, frame_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'thinking', ?)`),
    updateAnswer: db.prepare<[string, string, string]>(
      `UPDATE qa_turns SET answer_text = ?, status = ? WHERE id = ?`
    ),
    findById: db.prepare<string, QaRow>(`SELECT * FROM qa_turns WHERE id = ?`),
    listBySession: db.prepare<string, QaRow>(
      `SELECT * FROM qa_turns WHERE session_id = ? ORDER BY created_at ASC`
    )
  };

  return {
    create(input: { sessionId: string; profileId: string; question: string; frameId?: string }): QaTurn {
      const id = newId("qa");
      const now = nowIso();
      stmts.insert.run(id, input.sessionId, input.profileId, input.question, input.frameId ?? null, now);
      return {
        id,
        sessionId: input.sessionId,
        profileId: input.profileId,
        questionText: input.question,
        frameId: input.frameId,
        status: "thinking",
        createdAt: now
      };
    },
    setResult(id: string, answer: string, status: QaTurn["status"]): void {
      stmts.updateAnswer.run(answer, status, id);
    },
    markInterrupted(id: string): void {
      stmts.updateAnswer.run("", "interrupted", id);
    },
    findById(id: string): QaTurn | null {
      const row = stmts.findById.get(id);
      return row ? mapQa(row) : null;
    },
    listBySession(sessionId: string): QaTurn[] {
      return stmts.listBySession.all(sessionId).map(mapQa);
    }
  };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

interface ReportRow {
  id: string;
  session_id: string;
  profile_id: string;
  status: string;
  content_json: string;
  advice: string | null;
  created_at: string;
  updated_at: string;
}

function mapReport(row: ReportRow): Report {
  return {
    id: row.id,
    sessionId: row.session_id,
    profileId: row.profile_id,
    status: row.status as Report["status"],
    sections: decodeJson(row.content_json, []),
    advice: row.advice ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createReportRepo(db: DB) {
  const stmts = {
    upsertPending: db.prepare<[string, string, string]>(
      `INSERT INTO reports (id, session_id, profile_id, status, content_json, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', '[]', ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET status='pending', updated_at=excluded.updated_at`
    ),
    findBySession: db.prepare<string, ReportRow>(`SELECT * FROM reports WHERE session_id = ?`),
    complete: db.prepare<[string, string, string | null, string]>(
      `UPDATE reports SET status='done', content_json=?, advice=?, updated_at=? WHERE session_id=?`
    ),
    markFailed: db.prepare<[string]>(`UPDATE reports SET status='failed', updated_at=? WHERE session_id=?`)
  };

  return {
    ensurePending(sessionId: string, profileId: string): Report {
      const id = newId("rep");
      const now = nowIso();
      stmts.upsertPending.run(id, sessionId, profileId, now, now);
      const row = stmts.findBySession.get(sessionId);
      return mapReport(row!);
    },
    findBySession(sessionId: string): Report | null {
      const row = stmts.findBySession.get(sessionId);
      return row ? mapReport(row) : null;
    },
    complete(sessionId: string, sections: Report["sections"], advice?: string): void {
      stmts.complete.run(encodeJson(sections), advice ?? null, nowIso(), sessionId);
    },
    markFailed(sessionId: string): void {
      stmts.markFailed.run(nowIso(), sessionId);
    }
  };
}

// ---------------------------------------------------------------------------
// Error items
// ---------------------------------------------------------------------------

interface ErrorRow {
  id: string;
  profile_id: string;
  session_id: string;
  subject: string | null;
  page: number | null;
  question_no: string | null;
  bbox_json: string | null;
  error_type: string;
  status: string;
  correction: string | null;
  next_action: string | null;
  evidence_frame_id: string | null;
  knowledge_points: string | null;
  created_at: string;
  updated_at: string;
}

function mapError(row: ErrorRow, evidenceImageUrl?: string): ErrorItem {
  return {
    id: row.id,
    profileId: row.profile_id,
    sessionId: row.session_id,
    subject: row.subject ?? undefined,
    page: row.page ?? undefined,
    questionNo: row.question_no ?? undefined,
    bbox: decodeJson<BoundingBox | null>(row.bbox_json, null) ?? undefined,
    errorType: row.error_type as ErrorType,
    status: row.status as ErrorStatus,
    correction: row.correction ?? undefined,
    nextAction: row.next_action ?? undefined,
    evidenceFrameId: row.evidence_frame_id ?? undefined,
    evidenceImageUrl,
    knowledgePoints: decodeJson<string[]>(row.knowledge_points, []) ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createErrorRepo(db: DB, frameImageUrl: (frameId: string) => string | undefined) {
  const stmts = {
    insert: db.prepare<
      [
        string, string, string, string | null, number | null, string | null,
        string | null, string, string, string | null, string | null,
        string | null, string | null, string, string
      ]
    >(
      `INSERT INTO error_items
       (id, profile_id, session_id, subject, page, question_no, bbox_json,
        error_type, status, correction, next_action, evidence_frame_id,
        knowledge_points, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    findById: db.prepare<string, ErrorRow>(`SELECT * FROM error_items WHERE id = ?`),
    listByProfile: db.prepare<string, ErrorRow>(
      `SELECT * FROM error_items WHERE profile_id = ? ORDER BY created_at DESC`
    ),
    listByProfileStatus: db.prepare<[string, string], ErrorRow>(
      `SELECT * FROM error_items WHERE profile_id = ? AND status = ? ORDER BY created_at DESC`
    ),
    updateStatus: db.prepare<[string, string, string | null]>(
      `UPDATE error_items SET status=?, correction=COALESCE(?, correction), updated_at=? WHERE id=?`
    ),
    listBySession: db.prepare<string, ErrorRow>(
      `SELECT * FROM error_items WHERE session_id = ? ORDER BY created_at ASC`
    )
  };

  const map = (row: ErrorRow): ErrorItem => {
    const evidenceImageUrl = row.evidence_frame_id ? frameImageUrl(row.evidence_frame_id) : undefined;
    return mapError(row, evidenceImageUrl);
  };

  return {
    insert(input: {
      profileId: string;
      sessionId: string;
      subject?: string;
      page?: number;
      questionNo?: string;
      bbox?: BoundingBox;
      errorType: ErrorType;
      evidenceFrameId?: string;
      knowledgePoints?: string[];
      correction?: string;
      nextAction?: string;
    }): ErrorItem {
      const id = newId("err");
      const now = nowIso();
      const status: ErrorStatus = "suspected";
      stmts.insert.run(
        id,
        input.profileId,
        input.sessionId,
        input.subject ?? null,
        input.page ?? null,
        input.questionNo ?? null,
        input.bbox ? encodeJson(input.bbox) : null,
        input.errorType,
        status,
        input.correction ?? null,
        input.nextAction ?? null,
        input.evidenceFrameId ?? null,
        input.knowledgePoints ? encodeJson(input.knowledgePoints) : null,
        now,
        now
      );
      const row = stmts.findById.get(id)!;
      return map(row);
    },
    findById(id: string): ErrorItem | null {
      const row = stmts.findById.get(id);
      return row ? map(row) : null;
    },
    listByProfile(profileId: string): ErrorItem[] {
      return stmts.listByProfile.all(profileId).map(map);
    },
    listByProfileStatus(profileId: string, status: ErrorStatus): ErrorItem[] {
      return stmts.listByProfileStatus.all(profileId, status).map(map);
    },
    listBySession(sessionId: string): ErrorItem[] {
      return stmts.listBySession.all(sessionId).map(map);
    },
    updateStatus(id: string, status: ErrorStatus, correction?: string): ErrorItem | null {
      stmts.updateStatus.run(status, correction ?? null, nowIso(), id);
      const row = stmts.findById.get(id);
      return row ? map(row) : null;
    }
  };
}

// ---------------------------------------------------------------------------
// Review queue (SM-2)
// ---------------------------------------------------------------------------

interface ReviewRow {
  id: string;
  error_item_id: string;
  profile_id: string;
  due_at: string;
  interval_days: number;
  ease_factor: number;
  reps: number;
  last_result: string | null;
  created_at: string;
  updated_at: string;
}

function mapReview(
  row: ReviewRow,
  errorItem?: ErrorItem
): ReviewQueueItem {
  return {
    id: row.id,
    errorItemId: row.error_item_id,
    profileId: row.profile_id,
    dueAt: row.due_at,
    intervalDays: row.interval_days,
    easeFactor: row.ease_factor,
    reps: row.reps,
    lastResult: (row.last_result as ReviewResult | null) ?? undefined,
    errorItem
  };
}

export function createReviewRepo(db: DB, errorRepo: ReturnType<typeof createErrorRepo>) {
  const stmts = {
    upsertForError: db.prepare<
      [string, string, string, string, number, number]
    >(
      `INSERT INTO review_queue (id, error_item_id, profile_id, due_at, interval_days, ease_factor, reps, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 2.5, 0, ?, ?)
       ON CONFLICT(error_item_id) DO NOTHING`
    ),
    findByError: db.prepare<string, ReviewRow>(`SELECT * FROM review_queue WHERE error_item_id = ?`),
    findById: db.prepare<string, ReviewRow>(`SELECT * FROM review_queue WHERE id = ?`),
    dueByProfile: db.prepare<[string, string], ReviewRow>(
      `SELECT * FROM review_queue WHERE profile_id = ? AND due_at <= ? ORDER BY due_at ASC`
    ),
    listByProfile: db.prepare<string, ReviewRow>(
      `SELECT * FROM review_queue WHERE profile_id = ? ORDER BY due_at ASC`
    ),
    countByProfile: db.prepare<string, { c: number }>(
      `SELECT COUNT(*) AS c FROM review_queue WHERE profile_id = ?`
    ),
    updateSm2: db.prepare<[string, string, number, number, number, string]>(
      `UPDATE review_queue SET due_at=?, interval_days=?, ease_factor=?, reps=?, last_result=?, updated_at=? WHERE id=?`
    ),
    remove: db.prepare<string>(`DELETE FROM review_queue WHERE id = ?`)
  };

  return {
    /** 错题进入复习队列（幂等）。仅在 confirmed 状态下应调用。 */
    enqueue(errorItemId: string, profileId: string): ReviewQueueItem | null {
      const id = newId("rvq");
      const now = nowIso();
      stmts.upsertForError.run(id, errorItemId, profileId, now, 1, now, now);
      const row = stmts.findByError.get(errorItemId);
      return row ? mapReview(row) : null;
    },
    findById(id: string): ReviewQueueItem | null {
      const row = stmts.findById.get(id);
      if (!row) return null;
      const errorItem = errorRepo.findById(row.error_item_id) ?? undefined;
      return mapReview(row, errorItem);
    },
    dueByProfile(profileId: string, now = nowIso()): ReviewQueueItem[] {
      return stmts.dueByProfile.all(profileId, now).map((row) => {
        const errorItem = errorRepo.findById(row.error_item_id) ?? undefined;
        return mapReview(row, errorItem);
      });
    },
    /** 取一条非到期的（提前复习），用于无到期错题时降级。 */
    nextUpcoming(profileId: string): ReviewQueueItem | null {
      const all = stmts.listByProfile.all(profileId);
      const row = all[0];
      if (!row) return null;
      const errorItem = errorRepo.findById(row.error_item_id) ?? undefined;
      return mapReview(row, errorItem);
    },
    countByProfile(profileId: string): number {
      return stmts.countByProfile.get(profileId)?.c ?? 0;
    },
    updateSm2(
      id: string,
      next: { dueAt: string; intervalDays: number; easeFactor: number; reps: number },
      result: ReviewResult
    ): void {
      stmts.updateSm2.run(
        next.dueAt,
        next.intervalDays,
        next.easeFactor,
        next.reps,
        result,
        nowIso(),
        id
      );
    },
    recordResult(queueId: string, result: ReviewResult): void {
      db.prepare(`INSERT INTO review_results (id, queue_id, result, reviewed_at) VALUES (?, ?, ?, ?)`).run(
        newId("rvr"),
        queueId,
        result,
        nowIso()
      );
    },
    /** mastered 时把复习项移除（错题状态也升为 mastered）。 */
    remove(id: string): void {
      stmts.remove.run(id);
    }
  };
}

// ---------------------------------------------------------------------------
// Profile portrait
// ---------------------------------------------------------------------------

export function createPortraitRepo(db: DB) {
  const stmts = {
    upsert: db.prepare<[string, string, string]>(
      `INSERT INTO profiles_portrait (profile_id, portrait_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(profile_id) DO UPDATE SET portrait_json=excluded.portrait_json, updated_at=excluded.updated_at`
    ),
    find: db.prepare<string, { portrait_json: string; updated_at: string }>(
      `SELECT portrait_json, updated_at FROM profiles_portrait WHERE profile_id = ?`
    )
  };

  return {
    upsert(profileId: string, portrait: Omit<ProfilePortrait, "profileId" | "updatedAt">): ProfilePortrait {
      const now = nowIso();
      stmts.upsert.run(profileId, encodeJson(portrait), now);
      return { profileId, updatedAt: now, ...portrait };
    },
    find(profileId: string): ProfilePortrait | null {
      const row = stmts.find.get(profileId);
      if (!row) return null;
      const data = decodeJson<Omit<ProfilePortrait, "profileId" | "updatedAt">>(row.portrait_json, {
        weakPoints: [],
        errorTypes: {} as Record<ErrorType, number>,
        subjectDist: {},
        recentSummary: undefined,
        reviewSummary: undefined,
        frequentQuestions: []
      });
      return { profileId, updatedAt: row.updated_at, ...data };
    }
  };
}

export type Repos = ReturnType<typeof createRepos>;

/** 聚合所有 repo，方便注入。 */
export function createRepos(db: DB) {
  const users = createUserRepo(db);
  const profiles = createProfileRepo(db);
  const sessions = createSessionRepo(db);
  const frames = createFrameRepo(db);
  const qa = createQaRepo(db);
  const reports = createReportRepo(db);
  const errors = createErrorRepo(db, (frameId) => frames.findById(frameId)?.imageUrl);
  const review = createReviewRepo(db, errors);
  const portrait = createPortraitRepo(db);
  const portraitBuilder = new PortraitBuilder(db);
  return { users, profiles, sessions, frames, qa, reports, errors, review, portrait, __portraitBuilder: portraitBuilder };
}
