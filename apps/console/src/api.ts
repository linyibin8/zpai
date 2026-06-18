import type {
  AuthLoginRequest,
  AuthRegisterRequest,
  AuthTokenResponse,
  ErrorItem,
  ErrorStatus,
  HealthResponse,
  Profile,
  ProfilePortrait,
  QaAskRequest,
  QaTurn,
  Report,
  ReviewQueueItem,
  ReviewResult,
  ReviewTodayResponse,
  Session,
  User
} from "@zpai/shared";

const TOKEN_KEY = "zpai.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    let msg = "请求失败 (" + res.status + ")";
    try {
      const err = (await res.json()) as { message?: string };
      if (err.message) msg = err.message;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function qsForStatus(status?: ErrorStatus): string {
  if (!status) return "";
  return "?status=" + status;
}

export const api = {
  health: () => request<HealthResponse>("GET", "/api/health"),

  register: (body: AuthRegisterRequest) => request<AuthTokenResponse>("POST", "/api/auth/register", body),
  login: (body: AuthLoginRequest) => request<AuthTokenResponse>("POST", "/api/auth/login", body),
  me: () => request<User>("GET", "/api/auth/me"),

  profiles: () => request<Profile[]>("GET", "/api/profiles"),
  sessions: (profileId: string) => request<Session[]>("GET", "/api/profiles/" + profileId + "/sessions"),
  report: (sessionId: string) => request<Report>("GET", "/api/sessions/" + sessionId + "/report"),
  qa: (sessionId: string) => request<QaTurn[]>("GET", "/api/sessions/" + sessionId + "/qa"),

  errors: (profileId: string, status?: ErrorStatus) =>
    request<ErrorItem[]>("GET", "/api/profiles/" + profileId + "/errors" + qsForStatus(status)),
  updateError: (id: string, status: ErrorStatus, correction?: string) =>
    request<ErrorItem>("PATCH", "/api/errors/" + id, { status, correction }),

  todayReview: (profileId: string) => request<ReviewTodayResponse>("GET", "/api/profiles/" + profileId + "/review/today"),
  reviewQueue: (profileId: string) => request<ReviewQueueItem[]>("GET", "/api/profiles/" + profileId + "/review"),
  recordReview: (queueId: string, result: ReviewResult) =>
    request<{ ok: boolean }>("POST", "/api/review/" + queueId + "/result", { result }),

  portrait: (profileId: string) => request<ProfilePortrait>("GET", "/api/profiles/" + profileId + "/portrait"),
  refreshPortrait: (profileId: string) =>
    request<ProfilePortrait>("POST", "/api/profiles/" + profileId + "/portrait/refresh"),

  ask: (body: QaAskRequest) => request<{ turn: QaTurn }>("POST", "/api/qa/ask", body)
};
