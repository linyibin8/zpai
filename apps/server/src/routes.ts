/**
 * Fastify 路由层。
 *
 * 职责：HTTP 解析、鉴权、参数校验、调用 orchestrator/repos、返回共享类型响应。
 * 业务逻辑都在 orchestrator / repos / ai 里，路由保持薄。
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  AuthLoginRequest,
  AuthRegisterRequest,
  AuthTokenResponse,
  ErrorStatus,
  HealthResponse,
  ProfileCreateRequest,
  ProfileMemberAddRequest,
  QaAskRequest,
  ReviewResult,
  ReviewResultRequest,
  FrameUploadRequest,
  UserRole
} from "@zpai/shared";
import type { Orchestrator } from "./orchestrator.js";
import type { Repos } from "./repos.js";
import { verifyToken, extractBearer, hashPassword, verifyPassword, signToken } from "./auth.js";
import { newId } from "./util.js";

const VALID_ROLES = new Set<UserRole>(["student", "parent", "teacher"]);
const VALID_ERROR_STATUS = new Set<ErrorStatus>(["suspected", "confirmed", "ignored", "corrected", "mastered"]);
const VALID_REVIEW_RESULT = new Set<ReviewResult>(["right", "wrong", "later", "mastered"]);

export interface RouteDeps {
  app: FastifyInstance;
  repos: Repos;
  orch: Orchestrator;
  version: string;
}

/** 鉴权：从 Bearer 头解析 JWT，注入 request.user；失败 401。 */
function authPlugin(app: FastifyInstance) {
  app.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    const token = extractBearer(req.headers.authorization);
    if (!token) {
      return reply.code(401).send({ error: "unauthorized", message: "缺少认证 token" });
    }
    try {
      const payload = verifyToken(token);
      (req as AuthenticatedRequest).user = { id: payload.sub, role: payload.role as UserRole };
    } catch {
      return reply.code(401).send({ error: "unauthorized", message: "token 无效或已过期" });
    }
  });
}

interface AuthenticatedRequest {
  user?: { id: string; role: UserRole };
}

function bad(reply: FastifyReply, status: number, message: string) {
  return reply.code(status).send({ error: "bad_request", message });
}
function notFound(reply: FastifyReply, message: string) {
  return reply.code(404).send({ error: "not_found", message });
}
function forbidden(reply: FastifyReply, message: string) {
  return reply.code(403).send({ error: "forbidden", message });
}

export function registerRoutes(deps: RouteDeps): void {
  const { app, repos, orch } = deps;

  authPlugin(app);
  const authenticate = (app as unknown as { authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown> }).authenticate;

  // ---- 健康检查 ----
  app.get("/api/health", (_req, reply) => {
    const body: HealthResponse = {
      status: "ok",
      service: "zpai",
      version: deps.version,
      time: new Date().toISOString()
    };
    reply.send(body);
  });

  // ---- 认证 ----
  app.post("/api/auth/register", async (req, reply) => {
    const body = req.body as AuthRegisterRequest;
    if (!body || !VALID_ROLES.has(body.role)) return bad(reply, 400, "role 非法");
    if (!body.username || body.username.length < 3) return bad(reply, 400, "username 至少 3 字符");
    if (!body.password || body.password.length < 6) return bad(reply, 400, "password 至少 6 字符");

    const existing = repos.users.findByUsername(body.username);
    if (existing) return bad(reply, 409, "用户名已存在");

    const passwordHash = await hashPassword(body.password);
    const user = repos.users.create({
      role: body.role,
      username: body.username,
      passwordHash,
      displayName: body.displayName || body.username
    });
    const token = signToken({ sub: user.id, role: user.role });
    const res: AuthTokenResponse = { token, user };
    reply.code(201).send(res);
  });

  app.post("/api/auth/login", async (req, reply) => {
    const body = req.body as AuthLoginRequest;
    if (!body?.username || !body?.password) return bad(reply, 400, "需要 username 和 password");
    const found = repos.users.findByUsername(body.username);
    if (!found) return reply.code(401).send({ error: "unauthorized", message: "用户名或密码错误" });
    const ok = await verifyPassword(body.password, found.passwordHash);
    if (!ok) return reply.code(401).send({ error: "unauthorized", message: "用户名或密码错误" });
    const token = signToken({ sub: found.user.id, role: found.user.role });
    const res: AuthTokenResponse = { token, user: found.user };
    reply.send(res);
  });

  app.get("/api/auth/me", { preHandler: authenticate }, async (req, reply) => {
    const user = (req as AuthenticatedRequest).user!;
    const found = repos.users.findById(user.id);
    if (!found) return notFound(reply, "用户不存在");
    reply.send(found);
  });

  // ---- 学生档案 ----
  app.get("/api/profiles", { preHandler: authenticate }, async (req, reply) => {
    const user = (req as AuthenticatedRequest).user!;
    reply.send(repos.profiles.listByUser(user.id));
  });

  app.post("/api/profiles", { preHandler: authenticate }, async (req, reply) => {
    const user = (req as AuthenticatedRequest).user!;
    const body = req.body as ProfileCreateRequest;
    if (!body?.name) return bad(reply, 400, "name 必填");
    const profile = repos.profiles.create({
      name: body.name,
      grade: body.grade,
      subjectFocus: body.subjectFocus,
      ownerId: user.id
    });
    reply.code(201).send(profile);
  });

  app.get("/api/profiles/:id", { preHandler: authenticate }, async (req, reply) => {
    const user = (req as AuthenticatedRequest).user!;
    const { id } = req.params as { id: string };
    const profile = repos.profiles.findById(id);
    if (!profile) return notFound(reply, "档案不存在");
    if (!repos.profiles.canAccess(id, user.id)) return forbidden(reply, "无权访问该档案");
    reply.send(profile);
  });

  app.post("/api/profiles/:id/members", { preHandler: authenticate }, async (req, reply) => {
    const user = (req as AuthenticatedRequest).user!;
    const { id } = req.params as { id: string };
    const body = req.body as ProfileMemberAddRequest;
    if (!repos.profiles.canAccess(id, user.id)) return forbidden(reply, "无权管理该档案");
    if (!body?.userId) return bad(reply, 400, "userId 必填");
    repos.profiles.addMember(id, body.userId, body.role);
    reply.code(201).send({ ok: true });
  });

  app.get("/api/profiles/:id/members", { preHandler: authenticate }, async (req, reply) => {
    const user = (req as AuthenticatedRequest).user!;
    const { id } = req.params as { id: string };
    if (!repos.profiles.canAccess(id, user.id)) return forbidden(reply, "无权访问该档案");
    reply.send(repos.profiles.listMembers(id));
  });

  // ---- 学习会话 ----
  app.post("/api/sessions", { preHandler: authenticate }, async (req, reply) => {
    const user = (req as AuthenticatedRequest).user!;
    const body = req.body as { profileId: string };
    if (!body?.profileId) return bad(reply, 400, "profileId 必填");
    if (!repos.profiles.canAccess(body.profileId, user.id)) return forbidden(reply, "无权访问该档案");
    const session = repos.sessions.start(body.profileId);
    reply.code(201).send(session);
  });

  app.get("/api/profiles/:id/sessions", { preHandler: authenticate }, async (req, reply) => {
    const user = (req as AuthenticatedRequest).user!;
    const { id } = req.params as { id: string };
    if (!repos.profiles.canAccess(id, user.id)) return forbidden(reply, "无权访问该档案");
    reply.send(repos.sessions.listByProfile(id));
  });

  app.get("/api/sessions/:id", { preHandler: authenticate }, async (req, reply) => {
    const user = (req as AuthenticatedRequest).user!;
    const { id } = req.params as { id: string };
    const session = repos.sessions.findById(id);
    if (!session) return notFound(reply, "会话不存在");
    if (!repos.profiles.canAccess(session.profileId, user.id)) return forbidden(reply, "无权访问");
    reply.send(session);
  });

  app.post("/api/sessions/:id/frames", { preHandler: authenticate }, async (req, reply) => {
    const user = (req as AuthenticatedRequest).user!;
    const { id } = req.params as { id: string };
    const body = req.body as FrameUploadRequest;
    const session = repos.sessions.findById(id);
    if (!session) return notFound(reply, "会话不存在");
    if (!repos.profiles.canAccess(session.profileId, user.id)) return forbidden(reply, "无权访问");
    if (!body?.imageDataUrl) return bad(reply, 400, "imageDataUrl 必填");

    const frame = await orch.ingestFrame({
      session,
      profileId: session.profileId,
      changeReason: body.changeReason,
      isKeyFrame: body.isKeyFrame,
      imageDataUrl: body.imageDataUrl,
      capturedAt: body.capturedAt
    });
    reply.code(201).send({ frame });
  });

  app.get("/api/sessions/:id/frames", { preHandler: authenticate }, async (req, reply) => {
    const user = (req as AuthenticatedRequest).user!;
    const { id } = req.params as { id: string };
    const session = repos.sessions.findById(id);
    if (!session) return notFound(reply, "会话不存在");
    if (!repos.profiles.canAccess(session.profileId, user.id)) return forbidden(reply, "无权访问");
    reply.send(repos.frames.listBySession(id));
  });

  app.post("/api/sessions/:id/end", { preHandler: authenticate }, async (req, reply) => {
    const user = (req as AuthenticatedRequest).user!;
    const { id } = req.params as { id: string };
    const session = repos.sessions.findById(id);
    if (!session) return notFound(reply, "会话不存在");
    if (!repos.profiles.canAccess(session.profileId, user.id)) return forbidden(reply, "无权访问");
    if (session.endedAt) return bad(reply, 409, "会话已结束");
    const body = (req.body as { summary?: string }) ?? {};
    orch.endSession(session, body.summary);
    reply.send({ ok: true });
  });

  // ---- 语音 QA ----
  app.post("/api/qa/ask", { preHandler: authenticate }, async (req, reply) => {
    const user = (req as AuthenticatedRequest).user!;
    const body = req.body as QaAskRequest;
    if (!body?.sessionId || !body?.profileId) return bad(reply, 400, "需要 sessionId 和 profileId");
    if (!repos.profiles.canAccess(body.profileId, user.id)) return forbidden(reply, "无权访问该档案");
    const session = repos.sessions.findById(body.sessionId);
    if (!session) return notFound(reply, "会话不存在");
    if (session.endedAt) return bad(reply, 409, "会话已结束");
    if (!body.question?.trim()) return bad(reply, 400, "question 不能为空");
    const turn = await orch.handleAsk({
      session,
      profileId: body.profileId,
      question: body.question.trim(),
      frameId: body.frameId,
      reviewQueueId: body.reviewQueueId
    });
    reply.code(201).send({ turn });
  });

  app.post("/api/qa/interrupt", { preHandler: authenticate }, async (req, reply) => {
    const user = (req as AuthenticatedRequest).user!;
    const body = req.body as { turnId: string; sessionId: string };
    if (!body?.turnId || !body?.sessionId) return bad(reply, 400, "需要 turnId 和 sessionId");
    const session = repos.sessions.findById(body.sessionId);
    if (!session) return notFound(reply, "会话不存在");
    if (!repos.profiles.canAccess(session.profileId, user.id)) return forbidden(reply, "无权访问");
    orch.interruptTurn(body.turnId, session);
    reply.send({ ok: true });
  });

  app.get("/api/sessions/:id/qa", { preHandler: authenticate }, async (req, reply) => {
    const user = (req as AuthenticatedRequest).user!;
    const { id } = req.params as { id: string };
    const session = repos.sessions.findById(id);
    if (!session) return notFound(reply, "会话不存在");
    if (!repos.profiles.canAccess(session.profileId, user.id)) return forbidden(reply, "无权访问");
    reply.send(repos.qa.listBySession(id));
  });

  // ---- 报告 ----
  app.get("/api/sessions/:id/report", { preHandler: authenticate }, async (req, reply) => {
    const user = (req as AuthenticatedRequest).user!;
    const { id } = req.params as { id: string };
    const session = repos.sessions.findById(id);
    if (!session) return notFound(reply, "会话不存在");
    if (!repos.profiles.canAccess(session.profileId, user.id)) return forbidden(reply, "无权访问");
    const report = repos.reports.findBySession(id);
    reply.send(report ?? { sessionId: id, status: "pending", sections: [] });
  });

  // ---- 错题 ----
  app.get("/api/profiles/:id/errors", { preHandler: authenticate }, async (req, reply) => {
    const user = (req as AuthenticatedRequest).user!;
    const { id } = req.params as { id: string };
    const status = (req.query as { status?: ErrorStatus }).status;
    if (!repos.profiles.canAccess(id, user.id)) return forbidden(reply, "无权访问该档案");
    const items = status
      ? repos.errors.listByProfileStatus(id, status)
      : repos.errors.listByProfile(id);
    reply.send(items);
  });

  app.patch("/api/errors/:id", { preHandler: authenticate }, async (req, reply) => {
    const user = (req as AuthenticatedRequest).user!;
    const { id } = req.params as { id: string };
    const body = req.body as { status: ErrorStatus; correction?: string };
    if (!body?.status || !VALID_ERROR_STATUS.has(body.status)) return bad(reply, 400, "status 非法");
    const item = repos.errors.findById(id);
    if (!item) return notFound(reply, "错题不存在");
    if (!repos.profiles.canAccess(item.profileId, user.id)) return forbidden(reply, "无权访问");
    orch.confirmError(id, body.status, body.correction);
    const updated = repos.errors.findById(id);
    reply.send(updated);
  });

  // ---- 复习 ----
  app.get("/api/profiles/:id/review/today", { preHandler: authenticate }, async (req, reply) => {
    const user = (req as AuthenticatedRequest).user!;
    const { id } = req.params as { id: string };
    if (!repos.profiles.canAccess(id, user.id)) return forbidden(reply, "无权访问该档案");
    reply.send(orch.todayReview(id));
  });

  app.post("/api/review/:queueId/result", { preHandler: authenticate }, async (req, reply) => {
    const user = (req as AuthenticatedRequest).user!;
    const { queueId } = req.params as { queueId: string };
    const body = req.body as ReviewResultRequest;
    if (!body?.result || !VALID_REVIEW_RESULT.has(body.result)) return bad(reply, 400, "result 非法");
    const item = repos.review.findById(queueId);
    if (!item) return notFound(reply, "复习项不存在");
    if (!repos.profiles.canAccess(item.profileId, user.id)) return forbidden(reply, "无权访问");
    orch.recordReview(queueId, body.result);
    reply.send({ ok: true });
  });

  app.get("/api/profiles/:id/review", { preHandler: authenticate }, async (req, reply) => {
    const user = (req as AuthenticatedRequest).user!;
    const { id } = req.params as { id: string };
    if (!repos.profiles.canAccess(id, user.id)) return forbidden(reply, "无权访问该档案");
    reply.send(repos.review.dueByProfile(id));
  });

  // ---- 学习画像 ----
  app.get("/api/profiles/:id/portrait", { preHandler: authenticate }, async (req, reply) => {
    const user = (req as AuthenticatedRequest).user!;
    const { id } = req.params as { id: string };
    if (!repos.profiles.canAccess(id, user.id)) return forbidden(reply, "无权访问该档案");
    // 先返回缓存的；若无则即时构建一份
    let portrait = repos.portrait.find(id);
    if (!portrait) {
      const built = repos.__portraitBuilder?.build(id);
      if (built) portrait = repos.portrait.upsert(id, built);
    }
    reply.send(portrait ?? { profileId: id, weakPoints: [], errorTypes: {}, subjectDist: {}, frequentQuestions: [], updatedAt: new Date().toISOString() });
  });

  app.post("/api/profiles/:id/portrait/refresh", { preHandler: authenticate }, async (req, reply) => {
    const user = (req as AuthenticatedRequest).user!;
    const { id } = req.params as { id: string };
    if (!repos.profiles.canAccess(id, user.id)) return forbidden(reply, "无权访问该档案");
    const built = repos.__portraitBuilder?.build(id);
    const portrait = built ? repos.portrait.upsert(id, built) : null;
    reply.send(portrait);
  });
}

/** 占位导出避免未用警告（newId 用于未来扩展）。 */
export const _internal = { newId };
