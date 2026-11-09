/**
 * 事实库的 DDL 与版本号。
 *
 * 原则：库里只放服务器告诉过我们的事实；阶段、角标、推导依据每次现算。
 * 迁移规则见 `.scratch/devops-board/research/03-schema.md`。
 */

export const SCHEMA_VERSION = 1;

export const DDL_V1 = `
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT
);

CREATE TABLE IF NOT EXISTS board (
  board_id     INTEGER PRIMARY KEY,
  columns_json TEXT NOT NULL,
  rank_field   TEXT NOT NULL,
  fetched_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sprint (
  id       INTEGER PRIMARY KEY,
  board_id INTEGER NOT NULL,
  name     TEXT NOT NULL,
  state    TEXT NOT NULL,
  start_at INTEGER,
  end_at   INTEGER
);

CREATE TABLE IF NOT EXISTS issue (
  key           TEXT PRIMARY KEY NOT NULL,
  project       TEXT NOT NULL,
  sprint_id     INTEGER,
  status_id     TEXT NOT NULL,
  status_name   TEXT NOT NULL,
  type          TEXT NOT NULL,
  summary       TEXT NOT NULL,
  priority      TEXT,
  assignee      TEXT,
  epic_key      TEXT,
  parent_key    TEXT,
  comment_count INTEGER NOT NULL DEFAULT 0,
  rank          TEXT,
  updated_at    INTEGER,
  fetched_scope TEXT NOT NULL,
  seen_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_issue_scope ON issue(fetched_scope);

CREATE TABLE IF NOT EXISTS mr (
  project      TEXT NOT NULL,
  iid          INTEGER NOT NULL,
  state        TEXT NOT NULL,
  title        TEXT NOT NULL,
  source_branch TEXT NOT NULL,
  target_branch TEXT NOT NULL,
  author_id    INTEGER,
  author_name  TEXT,
  created_at   INTEGER,
  updated_at   INTEGER,
  merged_at    INTEGER,
  merge_commit_sha TEXT,
  draft        INTEGER NOT NULL DEFAULT 0,
  has_conflicts INTEGER,
  blocking_discussions_resolved INTEGER,
  reviewer_ids TEXT,
  web_url      TEXT,
  -- 审批结论也是服务端事实：离线恢复要能现算阶段
  approved     INTEGER,
  approvals_left INTEGER,
  fetched_scope TEXT NOT NULL,
  seen_at      INTEGER NOT NULL,
  -- 同一个 MR 可能被两个 scope 各写一份：分支全量（Jira 板）与个人切片（MR 板）
  PRIMARY KEY (project, iid, fetched_scope)
);
CREATE INDEX IF NOT EXISTS idx_mr_scope ON mr(fetched_scope);

CREATE TABLE IF NOT EXISTS mr_approval (
  project     TEXT NOT NULL,
  iid         INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  user_name   TEXT,
  approved_at INTEGER,
  seen_at     INTEGER NOT NULL,
  PRIMARY KEY (project, iid, user_id)
);

CREATE TABLE IF NOT EXISTS build (
  job_path    TEXT NOT NULL,
  number      INTEGER NOT NULL,
  result      TEXT,
  started_at  INTEGER NOT NULL,
  duration_ms INTEGER,
  sha         TEXT,
  url         TEXT,
  seen_at     INTEGER NOT NULL,
  PRIMARY KEY (job_path, number)
);

CREATE TABLE IF NOT EXISTS fetch_state (
  scope            TEXT PRIMARY KEY,
  last_success_at  INTEGER,
  last_attempt_at  INTEGER,
  attempting_until INTEGER NOT NULL DEFAULT 0,
  owner            TEXT,
  last_error       TEXT
);
`;
