/**
 * 服务端配置：统一从环境变量读取，带类型与默认值。
 * 真实密钥只放在服务机 .env，不进仓库。
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 手动加载 .env（不依赖 dotenv）。
 * 在 config 读取 process.env 之前执行：把 .env 里的 KEY=VALUE 写入 process.env，
 * 但不覆盖已存在的环境变量（让 PM2/系统 env 优先）。
 * 查找顺序：cwd/.env → 上两级 ../.env（apps/server 的根 .env）。
 */
function loadEnvFile(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../.env"),
    resolve(process.cwd(), "../../.env")
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const content = readFileSync(path, "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        // 去掉首尾引号
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        // 不覆盖已存在的环境变量
        if (process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
      return; // 找到第一个就停
    } catch {
      // 读失败则尝试下一个候选
    }
  }
}

loadEnvFile();

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
