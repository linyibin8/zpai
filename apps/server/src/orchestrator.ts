/**
 * 编排服务：把 repos / ai / 任务队列 / 事件总线 串起来。
 *
 * 职责：
 * - 处理一帧变化帧上传（存盘 + 入库 + 推事件）
 * - 处理一次 QA 提问（建 turn → 调视觉问答 → 写回答案 → 推事件）
 * - session 结束：触发异步 generateReport + extractErrors
 * - 错题确认进入复习队列
 * - 复习结果 → SM-2 调度更新
 */

import type { Repos } from "./repos.js";
import type { DB } from "./db.js";
import type { RealtimeHub } from "./realtime.js";
import type { TaskQueue } from "./taskQueue.js";
import type { LlmClient, VisionQa, ReportGenerator, ErrorExtractor } from "./ai/index.js";
import { saveFrameImage } from "./uploads.js";
import { publicUploadUrl } from "./config.js";
import { nextDueAt, scheduleSm2 } from "./sm2.js";
import type {
  ErrorStatus,
  ErrorType,
  Frame,
  FrameChangeReason,
  Message,
  QaTurn,
  ReviewResult,
  Session
} from "@zpai/shared";

export interface OrchestratorDeps {
  db: DB;
  repos: Repos;
  hub: RealtimeHub;
  queue: TaskQueue;
  llm: LlmClient;
  visionQa: VisionQa;
  reportGenerator: ReportGenerator;
  errorExtractor: ErrorExtractor;
  logger?: (msg: string) => void;
}

export class Orchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  private get log() {
    return this.deps.logger ?? (() => {});
  }

  // ---- 观察帧 ----

  async ingestFrame(input: {
    session: Session;
    profileId: string;
    changeReason: FrameChangeReason;
    isKeyFrame: boolean;
    imageDataUrl: string;
    capturedAt?: string;
  }): Promise<Frame> {
    const { session, profileId } = input;
    const saved = saveFrameImage(input.imageDataUrl, { profileId, sessionId: session.id });
    const frame = this.deps.repos.frames.insert({
      sessionId: session.id,
      imagePath: saved.publicUrl,
      changeReason: input.changeReason,
      isKeyFrame: input.isKeyFrame,
      capturedAt: input.capturedAt
    });
    this.deps.hub.publish(
      { type: "frame.captured", frame },
      { sessionId: session.id, profileId }
    );
    this.log(`[orch] frame ingested ${frame.id} (${input.changeReason})`);
    return frame;
  }

  // ---- 语音 QA ----

  async handleAsk(input: {
    session: Session;
    profileId: string;
    question: string;
    frameId?: string;
    reviewQueueId?: string;
  }): Promise<QaTurn> {
    const { session, profileId } = input;
    // 找证据帧：显式传 > 会话最近关键帧
    const frame = input.frameId
      ? this.deps.repos.frames.findById(input.frameId)
      : this.deps.repos.frames.latestKeyFrame(session.id) ?? undefined;

    const turn = this.deps.repos.qa.create({
      sessionId: session.id,
      profileId,
      question: input.question,
      frameId: frame?.id
    });
    this.deps.hub.publish({ type: "qa.created", turn }, { sessionId: session.id, profileId });

    // 异步回答，不阻塞 HTTP 响应
    void this.answerTurn(turn, session, frame?.imageUrl, input.reviewQueueId);
    return turn;
  }

  private async answerTurn(
    turn: QaTurn,
    session: Session,
    imageUrl: string | undefined,
    reviewQueueId?: string
  ): Promise<void> {
    try {
      const history = this.buildContext(session.id);
      // 复习场景：不抓当前镜头
      const isReview = Boolean(reviewQueueId);
      const answer = await this.deps.visionQa.answer({
        question: turn.questionText,
        imageDataUrl: isReview ? undefined : imageUrl,
        context: history,
        isReview
      });

      this.deps.repos.qa.setResult(turn.id, answer, "answered");
      const updated: QaTurn = { ...turn, answerText: answer, status: "answered" };
      this.deps.hub.publish({ type: "qa.done", turn: updated }, { sessionId: session.id, profileId: turn.profileId });
    } catch (err) {
      this.log(`[orch] answerTurn failed: ${(err as Error).message}`);
      this.deps.repos.qa.setResult(turn.id, "", "failed");
    }
  }

  private buildContext(sessionId: string): Message[] {
    const turns = this.deps.repos.qa.listBySession(sessionId);
    const out: Message[] = [];
    for (const t of turns.slice(-8)) {
      out.push({ actor: "user", text: t.questionText, createdAt: t.createdAt });
      if (t.answerText) out.push({ actor: "assistant", text: t.answerText, createdAt: t.createdAt });
    }
    return out;
  }

  interruptTurn(turnId: string, session: Session): void {
    this.deps.repos.qa.markInterrupted(turnId);
    this.deps.hub.publish({ type: "qa.interrupted", turnId }, { sessionId: session.id, profileId: session.profileId });
  }

  // ---- session 结束 → 异步任务 ----

  endSession(session: Session, summary?: string): void {
    this.deps.repos.sessions.end(session.id, summary);
    const ctx = { sessionId: session.id, profileId: session.profileId };
    // 先建 pending report，客户端可立即看到"生成中"
    this.deps.repos.reports.ensurePending(session.id, session.profileId);
    this.deps.queue.enqueue("generateReport", ctx, (c) => this.runGenerateReport(c.sessionId));
    this.deps.queue.enqueue("extractErrors", ctx, (c) => this.runExtractErrors(c.sessionId));
    this.log(`[orch] session ended ${session.id}, queued report + errors`);
  }

  private async runGenerateReport(sessionId: string): Promise<void> {
    const session = this.deps.repos.sessions.findById(sessionId);
    if (!session) return;
    const profile = this.deps.repos.profiles.findById(session.profileId);
    if (!profile) return;

    const keyFrames = this.deps.repos.frames.listKeyFrames(sessionId);
    const qaTurns = this.deps.repos.qa.listBySession(sessionId);
    const errorItems = this.deps.repos.errors.listBySession(sessionId);

    const result = await this.deps.reportGenerator.generate({
      keyFrames,
      qaTurns,
      errorItems,
      profile: { name: profile.name, grade: profile.grade, subjectFocus: profile.subjectFocus },
      sessionStartedAt: session.startedAt,
      sessionEndedAt: session.endedAt
    });
    this.deps.repos.reports.complete(sessionId, result.sections, result.advice);

    const report = this.deps.repos.reports.findBySession(sessionId);
    if (report) {
      this.deps.hub.publish({ type: "report.updated", report }, { sessionId, profileId: session.profileId });
    }
    // 更新 session 摘要
    const summary = result.sections[0]?.content.slice(0, 200);
    this.deps.repos.sessions.end(sessionId, summary);
    this.log(`[orch] report generated for ${sessionId}`);
  }

  private async runExtractErrors(sessionId: string): Promise<void> {
    const session = this.deps.repos.sessions.findById(sessionId);
    if (!session) return;
    const keyFrames = this.deps.repos.frames.listKeyFrames(sessionId);
    for (const frame of keyFrames) {
      // 跳过已经有 analysis 的帧
      if (frame.analysis) continue;
      try {
        const dataUrl = await this.fetchFrameDataUrl(frame.imageUrl);
        if (!dataUrl) continue;
        const extracted = await this.deps.errorExtractor.extract({
          imageDataUrl: dataUrl
        });
        // 简单写一帧 analysis 摘要
        if (extracted.length > 0) {
          this.deps.repos.frames.setAnalysis(frame.id, `疑似 ${extracted.length} 处错题`);
          for (const e of extracted) {
            this.deps.repos.errors.insert({
              profileId: session.profileId,
              sessionId,
              subject: undefined,
              page: e.page,
              questionNo: e.questionNo,
              errorType: e.errorType,
              evidenceFrameId: frame.id,
              knowledgePoints: e.knowledgePoints,
              correction: e.correction
            });
          }
          this.log(`[orch] extracted ${extracted.length} errors from frame ${frame.id}`);
        }
      } catch (err) {
        this.log(`[orch] extractErrors frame ${frame.id} failed: ${(err as Error).message}`);
      }
    }
  }

  /** 把已落盘的图片读回 data url（错题抽取需要原图传给模型）。 */
  private async fetchFrameDataUrl(publicUrl: string): Promise<string | undefined> {
    // publicUrl 形如 https://host/uploads/profiles/.../x.jpg
    // 本机直接读文件更快；这里简单用 fetch 兜底（生产同机部署可改本地读）。
    try {
      const res = await fetch(publicUrl);
      if (!res.ok) return undefined;
      const buf = Buffer.from(await res.arrayBuffer());
      const mime = publicUrl.endsWith(".png") ? "image/png" : publicUrl.endsWith(".webp") ? "image/webp" : "image/jpeg";
      return `data:${mime};base64,${buf.toString("base64")}`;
    } catch {
      return undefined;
    }
  }

  // ---- 错题确认 → 复习队列 ----

  confirmError(errorId: string, status: ErrorStatus, correction?: string): void {
    const updated = this.deps.repos.errors.updateStatus(errorId, status, correction);
    if (!updated) return;
    // 进入复习队列的条件：confirmed
    if (status === "confirmed") {
      this.deps.repos.review.enqueue(errorId, updated.profileId);
      this.log(`[orch] error ${errorId} confirmed → review queue`);
    }
    // 已掌握 / 已忽略：若有复习项则移除
    if (status === "mastered" || status === "ignored") {
      // reviewRepo 没有按 errorItemId 删除的方法，这里通过 enqueue 幂等 + mastered 时单独处理
    }
  }

  // ---- 复习结果 → SM-2 ----

  recordReview(queueId: string, result: ReviewResult): void {
    const item = this.deps.repos.review.findById(queueId);
    if (!item) return;
    const next = scheduleSm2(
      { reps: item.reps, easeFactor: item.easeFactor, intervalDays: item.intervalDays },
      result
    );
    this.deps.repos.review.recordResult(queueId, result);
    if (next.mastered || result === "mastered") {
      // 标记错题已掌握并移出复习队列
      this.deps.repos.errors.updateStatus(item.errorItemId, "mastered");
      this.deps.repos.review.remove(queueId);
    } else {
      this.deps.repos.review.updateSm2(
        queueId,
        { dueAt: nextDueAt(next.intervalDays), intervalDays: next.intervalDays, easeFactor: next.easeFactor, reps: next.reps },
        result
      );
    }
    this.log(`[orch] review ${queueId} result=${result} → next in ${next.intervalDays}d`);
  }

  /** 今日复习：到期优先，无到期可提前一条，完全无错题降级 5 分钟计划。 */
  todayReview(profileId: string): { due: ReturnType<Repos["review"]["dueByProfile"]>; fallback?: { kind: "five_minute_plan"; plan: string } } {
    const due = this.deps.repos.review.dueByProfile(profileId);
    if (due.length > 0) return { due };
    const upcoming = this.deps.repos.review.nextUpcoming(profileId);
    if (upcoming) return { due: [upcoming] };
    return {
      due: [],
      fallback: {
        kind: "five_minute_plan",
        plan: "目前没有需要复习的错题。可以用 5 分钟回顾最近学过的知识点，或者开始一次新的学习记录。"
      }
    };
  }
}

/** 让外部能拿到 publicUploadUrl 做兼容（部分地方用绝对 URL）。 */
export { publicUploadUrl };

/** 占位：ErrorType 默认值供路由层使用。 */
export const DEFAULT_ERROR_TYPE: ErrorType = "unknown";
