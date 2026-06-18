/**
 * 轻量异步任务队列。
 *
 * MVP 用内存队列 + 受限并发，不引入 Redis/Bull 等重依赖。
 * 任务类型：session 结束后触发的 generateReport、extractErrors。
 * 失败任务记录错误并完成（不无限重试，避免阻塞）。
 *
 * 生产可平滑升级为持久化队列：当前队列状态未落库，重启会丢失 pending 任务，
 * 但 session 结束接口会幂等重建 report(pending)，可接受。
 */

import { config } from "./config.js";

export interface TaskContext {
  sessionId: string;
  profileId: string;
}

type TaskHandler = (ctx: TaskContext) => Promise<void>;

interface Task {
  id: string;
  kind: string;
  ctx: TaskContext;
  handler: TaskHandler;
}

export class TaskQueue {
  private queue: Task[] = [];
  private running = 0;
  private readonly concurrency: number;
  private readonly logger: (msg: string) => void;

  constructor(
    concurrency = config.taskConcurrency,
    logger: (msg: string) => void = () => {}
  ) {
    this.concurrency = Math.max(1, concurrency);
    this.logger = logger;
  }

  enqueue(kind: string, ctx: TaskContext, handler: TaskHandler): void {
    this.queue.push({ id: `${kind}:${ctx.sessionId}:${Date.now()}`, kind, ctx, handler });
    this.logger(`[taskq] enqueued ${kind} for session ${ctx.sessionId}`);
    this.drain();
  }

  private drain(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) break;
      this.running += 1;
      void this.run(task);
    }
  }

  private async run(task: Task): Promise<void> {
    try {
      await task.handler(task.ctx);
      this.logger(`[taskq] done ${task.kind} for session ${task.ctx.sessionId}`);
    } catch (err) {
      this.logger(`[taskq] FAILED ${task.kind} for session ${task.ctx.sessionId}: ${(err as Error).message}`);
    } finally {
      this.running -= 1;
      this.drain();
    }
  }

  get pending(): number {
    return this.queue.length;
  }

  get active(): number {
    return this.running;
  }
}
