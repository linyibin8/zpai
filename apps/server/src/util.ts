/**
 * 通用工具：ID 生成、JSON 字段编解码、时间。
 */

import { nanoid } from "nanoid";

export function newId(prefix: string): string {
  return `${prefix}_${nanoid(21)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** 安全地把 JSON 写进 TEXT 列；undefined → null。 */
export function encodeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** 从 TEXT 列读出 JSON；空值返回 fallback。 */
export function decodeJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function truthy(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}
