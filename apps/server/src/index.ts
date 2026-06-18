/**
 * zpai 后端入口。
 *
 * 组装：Fastify + CORS + multipart + static + websocket + 路由 + 编排。
 * 生产：PM2 守护 node dist/index.js。
 * 开发：tsx watch src/index.ts。
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { config } from "./config.js";
import { openDatabase } from "./db.js";
import { createRepos } from "./repos.js";
import { RealtimeHub } from "./realtime.js";
import { TaskQueue } from "./taskQueue.js";
import { LlmClient, VisionQa, ReportGenerator, ErrorExtractor } from "./ai/index.js";
import { Orchestrator } from "./orchestrator.js";
import { registerRoutes } from "./routes.js";
import { extractBearer, verifyToken } from "./auth.js";
import { resolve } from "node:path";
import { mkdirSync, existsSync } from "node:fs";

const VERSION = "0.1.0";

async function main() {
  // 确保数据/上传目录存在
  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.uploadDir, { recursive: true });

  // 基础设施
  const db = openDatabase();
  const repos = createRepos(db);
  const hub = new RealtimeHub();
  const logger = (msg: string) => console.log(`[zpai] ${msg}`);
  const queue = new TaskQueue(config.taskConcurrency, logger);

  // AI 编排
  const llm = new LlmClient();
  const visionQa = new VisionQa(llm);
  const reportGenerator = new ReportGenerator(llm);
  const errorExtractor = new ErrorExtractor(llm);
  const orch = new Orchestrator({ db, repos, hub, queue, llm, visionQa, reportGenerator, errorExtractor, logger });

  // Fastify
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 * 1024 });

  await app.register(cors, {
    origin: [config.consoleOrigin, "http://localhost:5173"],
    credentials: true
  });
  await app.register(multipart, { limits: { fileSize: 16 * 1024 * 1024 } });
  await app.register(fastifyWebsocket, {
    options: { maxPayload: 1024 * 1024 }
  });

  // 路由（API）
  registerRoutes({ app, repos, orch, version: VERSION });

  // WebSocket：/ws
  app.get("/ws", { websocket: true }, (socket, req) => {
    const token = extractBearer(req.headers.authorization) ?? (req.query as { token?: string }).token;
    let authenticated = false;
    if (token) {
      try {
        verifyToken(token);
        authenticated = true;
      } catch {
        authenticated = false;
      }
    }
    if (!authenticated) {
      socket.close(4001, "unauthorized");
      return;
    }
    hub.addClient(socket, authenticated);
  });

  // 静态：上传文件
  await app.register(fastifyStatic, {
    root: resolve(config.uploadDir),
    prefix: "/uploads/",
    decorateReply: false
  });

  // 静态：console 前端（生产构建产物）
  const consoleDist = resolve("apps/console/dist");
  if (existsSync(consoleDist)) {
    await app.register(fastifyStatic, {
      root: consoleDist,
      prefix: "/",
      decorateReply: false
    });
  }

  // 启动
  await app.listen({ port: config.port, host: "0.0.0.0" });
  logger(`listening on :${config.port}, model=${config.llmModel}`);

  // 优雅退出
  const shutdown = (sig: string) => {
    logger(`received ${sig}, shutting down`);
    app.close().then(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[zpai] fatal:", err);
  process.exit(1);
});
