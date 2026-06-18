/**
 * 服务端配置：统一从环境变量读取，带类型与默认值。
 * 真实密钥只放在服务机 .env，不进仓库。
 */

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Env var ${name} must be an integer, got: ${raw}`);
  }
  return parsed;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1" || raw === "yes";
}

export interface ServerConfig {
  port: number;
  consoleOrigin: string;
  publicBaseUrl: string;
  dataDir: string;
  uploadDir: string;
  jwtSecret: string;
  jwtTtlDays: number;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  llmDisableThinking: boolean;
  maxImageChars: number;
  maxContextMessages: number;
  taskConcurrency: number;
}

function buildConfig(): ServerConfig {
  return {
    port: intEnv("PORT", 8787),
    consoleOrigin: required("CONSOLE_ORIGIN", "https://zpai.evowit.com"),
    publicBaseUrl: required("PUBLIC_BASE_URL", "https://zpai.evowit.com"),
    dataDir: required("DATA_DIR", "./data"),
    uploadDir: required("UPLOAD_DIR", "./uploads"),
    jwtSecret: required("JWT_SECRET", "dev-only-change-me"),
    jwtTtlDays: intEnv("JWT_TTL_DAYS", 30),
    llmBaseUrl: required("LLM_BASE_URL", "http://100.64.0.5:39000/v1"),
    llmApiKey: required("LLM_API_KEY", "ollama"),
    llmModel: required("LLM_MODEL", "evowit-agent27b"),
    llmDisableThinking: boolEnv("LLM_DISABLE_THINKING", true),
    maxImageChars: intEnv("MAX_IMAGE_CHARS", 2500000),
    maxContextMessages: intEnv("MAX_CONTEXT_MESSAGES", 12),
    taskConcurrency: intEnv("TASK_CONCURRENCY", 2)
  };
}

export const config = buildConfig();

/** 给上传文件生成对外可访问的 URL。 */
export function publicUploadUrl(relativePath: string): string {
  const base = config.publicBaseUrl.replace(/\/$/, "");
  const rel = relativePath.replace(/^\/+/, "");
  return `${base}/uploads/${rel}`;
}
