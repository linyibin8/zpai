/**
 * 文件上传服务：base64 data URL → 落盘到 uploadDir → 返回相对路径。
 *
 * 目录按 profile/session 分层，避免单目录文件过多。
 * 文件名用 nanoid + 原始扩展名，避免碰撞和路径注入。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { config } from "./config.js";
import { newId } from "./util.js";

/** 解析 data url，返回 {mime, buffer}；非法返回 null。 */
export function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer; ext: string } | null {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const base64 = match[2];
  try {
    const buffer = Buffer.from(base64, "base64");
    const ext = mime === "image/jpeg" || mime === "image/jpg" ? "jpg" : mime === "image/png" ? "png" : "webp";
    return { mime, buffer, ext };
  } catch {
    return null;
  }
}

export interface SaveResult {
  /** 相对 uploadDir 的路径，用于 URL 拼接，如 profiles/p_x/sessions/s_y/abc.jpg */
  relativePath: string;
  /** 存入 DB 的访问 URL（已拼好 PUBLIC_BASE_URL） */
  publicUrl: string;
}

/** 把一帧图片落盘并返回访问路径。 */
export function saveFrameImage(
  dataUrl: string,
  opts: { profileId: string; sessionId: string }
): SaveResult {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    throw new Error("Invalid image data URL");
  }
  const dir = join("profiles", opts.profileId, "sessions", opts.sessionId);
  const absDir = resolve(config.uploadDir, dir);
  mkdirSync(absDir, { recursive: true });
  const filename = `${newId("img")}.${parsed.ext}`;
  const absPath = join(absDir, filename);
  writeFileSync(absPath, parsed.buffer);
  const relativePath = `${dir}/${filename}`.replace(/\\/g, "/");
  const publicUrl = `${config.publicBaseUrl.replace(/\/$/, "")}/uploads/${relativePath}`;
  return { relativePath, publicUrl };
}
