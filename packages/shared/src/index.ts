/**
 * zpai 共享类型 —— 后端、Web 控制台、iOS（参考契约）共用。
 * 所有 REST/WS 消息结构在这里定义，三端保持一致。
 */

// ============================================================================
// 会话消息（LLM 上下文用）
// ============================================================================

export type MessageActor = "user" | "assistant";

/** 一条会话消息，用于构建多轮 LLM 上下文。 */
export interface Message {
  actor: MessageActor;
  text: string;
  createdAt: string; // ISO
}

// ============================================================================
// 账号与角色
// ============================================================================

export type UserRole = "student" | "parent" | "teacher";

/** 一个用户账号（学生/家长/老师） */
export interface User {
  id: string;
  role: UserRole;
  username: string;
  displayName: string;
  createdAt: string; // ISO
}

export interface AuthRegisterRequest {
  role: UserRole;
  username: string;
  password: string;
  displayName?: string;
}

export interface AuthLoginRequest {
  username: string;
  password: string;
}

export interface AuthTokenResponse {
  token: string;
  user: User;
}

// ============================================================================
// 学生档案（profile）：一个家长/老师可管多个学生档案
// ============================================================================

/** 学生档案 —— 学习数据归属的核心实体。家长/老师可管理多个档案。 */
export interface Profile {
  id: string;
  name: string;
  grade?: string;
  subjectFocus?: string;
  ownerId: string; // 创建者 user id
  createdAt: string;
}

export type ProfileMemberRole = "owner" | "parent" | "teacher";

export interface ProfileMember {
  profileId: string;
  userId: string;
  role: ProfileMemberRole;
  displayName: string;
}

export interface ProfileCreateRequest {
  name: string;
  grade?: string;
  subjectFocus?: string;
}

export interface ProfileMemberAddRequest {
  userId: string;
  role: Exclude<ProfileMemberRole, "owner">;
}

// ============================================================================
// 学习会话（session）与观察帧
// ============================================================================

export type FrameChangeReason =
  | "question_entered" // 题目进入画面
  | "writing_started" // 学生开始书写
  | "page_turned" // 翻页
  | "answer_changed" // 答案变化
  | "correction_appeared" // 出现订正
  | "long_stay" // 长时间停留某题
  | "manual"; // 手动抓拍

export interface Frame {
  id: string;
  sessionId: string;
  capturedAt: string; // ISO
  imageUrl: string; // 访问 url（/uploads/...）
  changeReason: FrameChangeReason;
  isKeyFrame: boolean;
  analysis?: string; // 该帧的简要分析（题目/作答状态），异步填充
}

export interface Session {
  id: string;
  profileId: string;
  startedAt: string;
  endedAt?: string;
  summary?: string;
  frameCount: number;
  qaCount: number;
}

export interface SessionStartRequest {
  profileId: string;
}

/** 上传一个有价值的观察帧 */
export interface FrameUploadRequest {
  changeReason: FrameChangeReason;
  isKeyFrame: boolean;
  /** JPEG base64 data url，服务端不截断、超限拒绝 */
  imageDataUrl: string;
  capturedAt?: string;
}

export interface FrameUploadResponse {
  frame: Frame;
}

// ============================================================================
// 语音问答（QA）
// ============================================================================

export type QaStatus = "thinking" | "answered" | "failed" | "interrupted";

export interface QaTurn {
  id: string;
  sessionId: string;
  profileId: string;
  questionText: string;
  /** 关联的证据帧，可能为空（纯追问沿用上一题上下文） */
  frameId?: string;
  answerText?: string;
  status: QaStatus;
  createdAt: string;
}

export interface QaAskRequest {
  sessionId: string;
  profileId: string;
  question: string;
  /** 不传则沿用会话最近关键帧 / 上下文 */
  frameId?: string;
  /** 复习场景：不抓当前镜头，只基于错题上下文 */
  reviewQueueId?: string;
}

export interface QaAskResponse {
  turn: QaTurn;
}

// ============================================================================
// 学习报告
// ============================================================================

export interface ReportSection {
  title: string;
  /** markdown / 纯文本，已基于实际拍到的证据生成 */
  content: string;
}

export interface Report {
  id: string;
  sessionId: string;
  profileId: string;
  /** 报告状态：pending 生成中 / done 已完成 / failed 生成失败 */
  status: "pending" | "done" | "failed";
  sections: ReportSection[];
  /** 给家长/老师的后续建议 */
  advice?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// 错题（error item）—— 状态机
// ============================================================================

export type ErrorStatus =
  | "suspected" // 疑似错题（抽取规则初筛）
  | "confirmed" // 确认错题（人工确认）
  | "ignored" // 已忽略（不是真错题）
  | "corrected" // 已订正
  | "mastered"; // 已掌握

export type ErrorType =
  | "calculation" // 计算错误
  | "concept" // 概念错误
  | "careless" // 粗心
  | "method" // 方法错误
  | "unknown"; // 待定

export interface BoundingBox {
  /** 归一化坐标 0~1，相对证据帧原图 */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ErrorItem {
  id: string;
  profileId: string;
  sessionId: string;
  subject?: string;
  page?: number;
  questionNo?: string;
  bbox?: BoundingBox;
  errorType: ErrorType;
  status: ErrorStatus;
  correction?: string;
  nextAction?: string;
  /** 来源证据帧 */
  evidenceFrameId?: string;
  evidenceImageUrl?: string;
  knowledgePoints?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ErrorStatusUpdate {
  status: ErrorStatus;
  correction?: string;
}

// ============================================================================
// 复习队列（SM-2 间隔重复）
// ============================================================================

export type ReviewResult = "right" | "wrong" | "later" | "mastered";

export interface ReviewQueueItem {
  id: string;
  errorItemId: string;
  profileId: string;
  dueAt: string; // ISO，下次到期
  intervalDays: number; // 当前间隔
  easeFactor: number; // 难度系数
  reps: number; // 已复习次数
  lastResult?: ReviewResult;
  /** 关联错题（前端展示用） */
  errorItem?: ErrorItem;
}

export interface ReviewResultRequest {
  result: ReviewResult;
}

export interface ReviewTodayResponse {
  /** 到期的复习项 */
  due: ReviewQueueItem[];
  /** 完全无错题时的降级计划 */
  fallback?: {
    kind: "five_minute_plan";
    plan: string;
  };
}

// ============================================================================
// 长期学习画像
// ============================================================================

export interface ProfilePortrait {
  profileId: string;
  /** 常见薄弱知识点 */
  weakPoints: string[];
  /** 常见错误类型分布 */
  errorTypes: Record<ErrorType, number>;
  /** 科目分布 */
  subjectDist: Record<string, number>;
  /** 最近学习内容摘要 */
  recentSummary?: string;
  /** 复习情况摘要 */
  reviewSummary?: string;
  /** 哪些问题经常被追问 */
  frequentQuestions: string[];
  updatedAt: string;
}

// ============================================================================
// WebSocket 实时事件
// ============================================================================

export type ClientEvent =
  | { type: "subscribe"; sessionId?: string; profileId?: string }
  | { type: "unsubscribe" };

export type ServerEvent =
  | { type: "frame.captured"; frame: Frame }
  | { type: "qa.created"; turn: QaTurn }
  | { type: "qa.delta"; turnId: string; text: string }
  | { type: "qa.done"; turn: QaTurn }
  | { type: "qa.interrupted"; turnId: string }
  | { type: "report.updated"; report: Report }
  | { type: "camera_log"; sessionId: string; message: string };

// ============================================================================
// 通用响应
// ============================================================================

export interface ApiError {
  error: string;
  message: string;
}

export interface HealthResponse {
  status: "ok";
  service: "zpai";
  version: string;
  time: string;
}
