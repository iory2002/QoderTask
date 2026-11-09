# 03 事实库 schema 与保留策略

原则一句话：**库里只放服务器告诉过我们的事实；阶段、角标、推导依据每次现算**。多窗口下这样最不容易出现"事实是新的、结论是旧的"。

## 1. DDL（v1）

```sql
PRAGMA user_version = 1;

CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT
);
-- first_seen_at（建库时间，指标的起点）、db_note

CREATE TABLE IF NOT EXISTS board (
  board_id     INTEGER PRIMARY KEY,
  columns_json TEXT NOT NULL,   -- [{id,name,statusIds}]
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
  key           TEXT PRIMARY KEY,
  project       TEXT NOT NULL,
  sprint_id     INTEGER,                 -- 钉住的卡可为 NULL
  status_id     TEXT NOT NULL,
  status_name   TEXT NOT NULL,
  type          TEXT NOT NULL,
  summary       TEXT NOT NULL,
  priority      TEXT,                    -- 卡面 chip 的唯一来源
  assignee      TEXT,
  epic_key      TEXT,
  parent_key    TEXT,
  comment_count INTEGER NOT NULL DEFAULT 0,
  rank          TEXT,
  updated_at    INTEGER,
  fetched_scope TEXT NOT NULL,           -- 'jira:board23'，供全量替换
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
  merge_commit_sha TEXT,                 -- 06 的祖先判定要用
  draft        INTEGER NOT NULL DEFAULT 0,
  has_conflicts INTEGER,                 -- NULL = 未知，不当 false
  blocking_discussions_resolved INTEGER, -- 同上
  fetched_scope TEXT NOT NULL,
  seen_at      INTEGER NOT NULL,
  PRIMARY KEY (project, iid)
);
CREATE INDEX IF NOT EXISTS idx_mr_scope ON mr(fetched_scope);

CREATE TABLE IF NOT EXISTS mr_approval (
  project     TEXT NOT NULL,
  iid         INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  user_name   TEXT,
  approved_at INTEGER,        -- 04 已确认可从 /approvals 拿到；仅取数失败时为 NULL
  seen_at     INTEGER NOT NULL,
  PRIMARY KEY (project, iid, user_id)
);

CREATE TABLE IF NOT EXISTS build (
  job_path    TEXT NOT NULL,
  number      INTEGER NOT NULL,
  result      TEXT,           -- NULL = 运行中
  started_at  INTEGER NOT NULL,
  duration_ms INTEGER,
  sha         TEXT,           -- 06 的祖先判定要用
  url         TEXT,
  seen_at     INTEGER NOT NULL,
  PRIMARY KEY (job_path, number)
);
```

`fetch_state` 属于 02，此处不重复。

**不落库**：`stage`、`buildFailed`、`buildChannel`、`evidence`、角标数字、`revision` 指纹、`mr.description`（只用来匹配 Jira key，匹配完即弃）。

## 2. 每轮怎么写

| scope | 写法 | 说明 |
|---|---|---|
| `jira:<boardId>` | **全量替换** | 一个事务内：`DELETE FROM issue WHERE fetched_scope=?` → 批量 `INSERT` → upsert `board` / `sprint` → 更新 `fetch_state` |
| `gitlab:<proj>@<branch>` | **全量替换** | 同上，另加：该 scope 下所有 `mr_approval` 先删后插（审批集合是快照） |
| `jenkins:<jobPath>` | **UPSERT，不删** | 构建是历史账本；只保留每 job 最近 **200** 条（超出按 `number` 升序删旧） |

全量替换的代价可忽略：issue 50~200 行、MR ≤ 300 行，实测 500 行一个事务 1ms。换来的是"库里的状态永远等于最近一次成功取数的快照"，不用处理服务端删了、本地还留着的脏行。

## 3. 保留与截断

| 表 | 保留 |
|---|---|
| `mr` / `mr_approval` | 永久（约 1200 条/年、< 2MB） |
| `build` | 每 job 最近 200 条 |
| `issue` | 只留当前 sprint（每轮替换） |
| `sprint` / `board` | 最近 10 条 sprint + 当前 board 配置 |

**指标的起点**：建库时写 `meta.first_seen_at`，指标界面必须显示"自 &lt;日期&gt; 起"。90 天取数窗口之外的事实永远补不回来——这一点要写在界面上，不能让人以为看到的是全历史。

> 2026-11-10 补：趋势指标（05）已被丢弃，因此"永久保留"的动机不再是算指标，而是多开共享、"合入后未推进"与"审批还差谁"这些卡面事实。保留成本极低（< 2MB/年），不因指标取消而改策略。

## 4. 维护

- **每次成功写入后**：`PRAGMA wal_checkpoint(TRUNCATE)`，把 `-wal` 收回，避免长跑后它变大
- **VACUUM**：不按时间做。仅当"确实删过行 **且** 库 > 20MB"时做一次（重写整库会持写锁，能不做就不做）
- 按上面估算，一年后库大小 < 5MB，正常情况下这两条都不会触发

## 5. 迁移与损坏

```
open db
  ├─ PRAGMA user_version > CODE_VERSION  → 只读模式（功能退回单窗口直连）+ 提示“库来自更新版本”
  ├─ user_version < CODE_VERSION         → 每个迁移一个事务，迁移前 copyFile 成 .bak，失败则换回
  └─ 打开失败 / PRAGMA integrity_check 不过 → 重命名为 facts.corrupt-<时间戳>.sqlite，
                                              重建空库，提示“历史已重置，指标从今天起算”
```

- 只读模式是**单向**的：不尝试把高版本库降级迁移，那只会把别人的数据弄坏
- 不做定时备份：事实都能重取，唯一需要保护的是迁移前的那一次 `.bak`
- 多个窗口同时首次建表：所有 DDL 用 `IF NOT EXISTS` + `user_version`，迁移用 `BEGIN IMMEDIATE` 串行化
