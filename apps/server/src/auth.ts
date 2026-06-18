/**
 * 认证：bcrypt 密码哈希 + JWT 签发/校验。
 * JWT 载荷只放 { sub: userId, role }，不放敏感信息。
 */

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "./config.js";

export interface JwtPayload {
  sub: string; // user id
  role: string;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: `${config.jwtTtlDays}d`
  });
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;
  return decoded;
}

/** 从 "Bearer xxx" 头解析出 token。 */
export function extractBearer(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  return match ? match[1] : null;
}
