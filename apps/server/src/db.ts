/**
 * SQLite 数据访问层（基于 Node 内置 node:sqlite）。
 *
 * 选 node:sqlite 而非 better-sqlite3：零原生编译依赖，
 * Windows/Ubuntu 开发与生产一致。Node 22+ 内置实验性 API。
 *
 * 提供一个轻适配，让 repos 层用类似 better-sqlite3 的 prepare<T>() 风格调用，
 * 内部转调 DatabaseSync。
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config } from "./config.js";

/** 一条已编译语句的适配包装。 */
export interface Statement<T = Record<string, unknown>> {
  get(...params: unknown[]): T | undefined;
  all(...params: unknown[]): T[];
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}

/** 适配后的 DB 接口：与 repos 层预期一致。 */
export interface DB {
  /**
   * 兼容 better-sqlite3 风格的双泛型签名：prepare<ParamTypes, RowType>(sql)。
   * 第一个泛型（绑定参数类型）仅作文档用，运行时不校验；第二个泛型是返回行类型。
   * 也支持 prepare<RowType>(sql) 单泛型写法。
   */
  prepare<TParams = unknown, TRow = Record<string, unknown>>(sql: string): Statement<TRow>;
  exec(sql: string): void;
  close(): void;
}

function adapt(db: DatabaseSync): DB {
  return {
    prepare<TParams = unknown, TRow = Record<string, unknown>>(sql: string): Statement<TRow> {
      const stmt = db.prepare(sql);
      return {
        get(...params: unknown[]) {
          const row = stmt.get(...(params as Parameters<typeof stmt.get>));
          return (row ?? undefined) as TRow | undefined;
        },
        all(...params: unknown[]) {
          return stmt.all(...(params as Parameters<typeof stmt.all>)) as TRow[];
        },
        run(...params: unknown[]) {
          return stmt.run(...(params as Parameters<typeof stmt.run>)) as {
            changes: number;
            lastInsertRowid: number | bigint;
          };
        }
      };
    },
    exec(sql: string): void {
      db.exec(sql);
    },
    close(): void {
      db.close();
    }
  };
}

const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  role          TEXT NOT NULL CHECK (role IN ('student','parent','teacher')),
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  grade          TEXT,
  subject_focus  TEXT,
  owner_id       TEXT NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profiles_owner ON profiles(owner_id);

CREATE TABLE IF NOT EXISTS profile_members (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('owner','parent','teacher')),
  PRIMARY KEY (profile_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_pmembers_user ON profile_members(user_id);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  started_at  TEXT NOT NULL,
  ended_at    TEXT,
  summary     TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_profile ON sessions(profile_id);

CREATE TABLE IF NOT EXISTS frames (
  id             TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  captured_at    TEXT NOT NULL,
  image_path     TEXT NOT NULL,
  change_reason  TEXT NOT NULL,
  is_key_frame   INTEGER NOT NULL DEFAULT 0,
  analysis       TEXT
);
CREATE INDEX IF NOT EXISTS idx_frames_session ON frames(session_id, captured_at);

CREATE TABLE IF NOT EXISTS qa_turns (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  profile_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  frame_id      TEXT REFERENCES frames(id) ON DELETE SET NULL,
  answer_text   TEXT,
  status        TEXT NOT NULL DEFAULT 'thinking',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qa_session ON qa_turns(session_id, created_at);

CREATE TABLE IF NOT EXISTS reports (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  profile_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',
  content_json TEXT NOT NULL,
  advice       TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_session ON reports(session_id);

CREATE TABLE IF NOT EXISTS error_items (
  id                 TEXT PRIMARY KEY,
  profile_id         TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  session_id         TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  subject            TEXT,
  page               INTEGER,
  question_no        TEXT,
  bbox_json          TEXT,
  error_type         TEXT NOT NULL DEFAULT 'unknown',
  status             TEXT NOT NULL DEFAULT 'suspected',
  correction         TEXT,
  next_action        TEXT,
  evidence_frame_id  TEXT REFERENCES frames(id) ON DELETE SET NULL,
  knowledge_points   TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_errors_profile_status ON error_items(profile_id, status);

CREATE TABLE IF NOT EXISTS review_queue (
  id              TEXT PRIMARY KEY,
  error_item_id   TEXT NOT NULL REFERENCES error_items(id) ON DELETE CASCADE,
  profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  due_at          TEXT NOT NULL,
  interval_days   INTEGER NOT NULL DEFAULT 1,
  ease_factor     REAL NOT NULL DEFAULT 2.5,
  reps            INTEGER NOT NULL DEFAULT 0,
  last_result     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(error_item_id)
);
CREATE INDEX IF NOT EXISTS idx_review_profile_due ON review_queue(profile_id, due_at);
CREATE INDEX IF NOT EXISTS idx_review_error ON review_queue(error_item_id);

CREATE TABLE IF NOT EXISTS review_results (
  id           TEXT PRIMARY KEY,
  queue_id     TEXT NOT NULL REFERENCES review_queue(id) ON DELETE CASCADE,
  result       TEXT NOT NULL,
  reviewed_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rresults_queue ON review_results(queue_id);

CREATE TABLE IF NOT EXISTS profiles_portrait (
  profile_id      TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  portrait_json   TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
`;

/** 打开并初始化数据库（文件）。node:sqlite 默认开启外键需要显式 PRAGMA。 */
export function openDatabase(path?: string): DB {
  const dbPath = resolve(path ?? resolve(config.dataDir, "zpai.db"));
  mkdirSync(dirname(dbPath), { recursive: true });

  const raw = new DatabaseSync(dbPath);
  raw.exec("PRAGMA journal_mode = WAL;");
  raw.exec("PRAGMA foreign_keys = ON;");
  raw.exec(SCHEMA);
  return adapt(raw);
}

/** 测试用：内存库。 */
export function openMemoryDatabase(): DB {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  raw.exec(SCHEMA);
  return adapt(raw);
}
