/**
 * WebSocket 实时事件总线。
 *
 * 客户端连接 /ws 后发 {type:"subscribe", sessionId?, profileId?} 订阅。
 * 服务端按订阅范围（session 或 profile）分发事件，未订阅/不匹配的连接收不到。
 * 支持 token 鉴权（查询参数 ?token= 或首条消息）。
 *
 * 事件类型见 @zpai/shared 的 ServerEvent。
 */

import type { WebSocket } from "ws";
import type { ServerEvent } from "@zpai/shared";
import type { RawData } from "ws";

interface Subscription {
  sessionId?: string;
  profileId?: string;
}

interface ClientState {
  ws: WebSocket;
  sub: Subscription;
  authenticated: boolean;
}

export class RealtimeHub {
  private clients = new Map<WebSocket, ClientState>();

  addClient(ws: WebSocket, authenticated: boolean, initialSub: Subscription = {}): void {
    this.clients.set(ws, { ws, sub: initialSub, authenticated });
    ws.on("message", (data: RawData) => this.onMessage(ws, data));
    ws.on("close", () => this.removeClient(ws));
    ws.on("error", () => this.removeClient(ws));
  }

  removeClient(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  private onMessage(ws: WebSocket, data: RawData): void {
    const client = this.clients.get(ws);
    if (!client) return;
    let parsed: unknown;
    try {
      const text = typeof data === "string" ? data : Buffer.from(data as Buffer).toString("utf8");
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    const msg = parsed as { type?: string; sessionId?: string; profileId?: string };
    if (msg.type === "subscribe") {
      client.sub = { sessionId: msg.sessionId, profileId: msg.profileId };
    } else if (msg.type === "unsubscribe") {
      client.sub = {};
    }
  }

  /** 给匹配订阅的客户端广播事件。 */
  publish(event: ServerEvent, target: { sessionId?: string; profileId?: string }): void {
    const payload = JSON.stringify(event);
    for (const client of this.clients.values()) {
      if (!client.authenticated) continue;
      if (this.matches(client.sub, target)) {
        this.safeSend(client.ws, payload);
      }
    }
  }

  private matches(sub: Subscription, target: { sessionId?: string; profileId?: string }): boolean {
    // session 级事件：客户端订阅了同 session 即匹配
    if (target.sessionId && sub.sessionId === target.sessionId) return true;
    // profile 级事件：客户端订阅了同 profile 即匹配
    if (target.profileId && sub.profileId === target.profileId) return true;
    return false;
  }

  private safeSend(ws: WebSocket, payload: string): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload, (err?: Error) => {
        if (err) this.removeClient(ws);
      });
    }
  }

  get connectedCount(): number {
    return this.clients.size;
  }
}
