# 02 协调协议：时间戳 + 短期占位，没有 leader

结论先说：**不做租约、不选"活跃实例"**。任何窗口发现某个 scope 过期且没人在取，就由它去取。刷新节奏自然等于"所有窗口里最勤的那个"，窗口崩掉也不需要接管——占位到期自然失效。

## 1. 状态表

```sql
CREATE TABLE IF NOT EXISTS fetch_state (
  scope             TEXT PRIMARY KEY,   -- 'jira:board23' | 'gitlab:proj@branch'
  last_success_at   INTEGER,            -- ms；NULL = 从未成功
  last_attempt_at   INTEGER,
  attempting_until  INTEGER NOT NULL DEFAULT 0,  -- 0 = 空闲
  owner             TEXT,               -- 窗口 uuid，只为排查问题
  last_error        TEXT
);
```

scope 粒度：Jira 用 `jira:<boardId>`（board 配置、sprint、issue 都在这一份里）；GitLab 用 `gitlab:<project>@<targetBranch>`。**一个窗口的 uuid 在 activate 时生成一次**，只用于写 owner，不参与任何判定。

## 2. 三个数字

| 名称 | 值 | 为什么 |
|---|---|---|
| TTL（多久算过期） | **50s** | 比 60s 的轮询短一点：每拍都能看到"刚更新过"，而不是永远差一点 |
| 占位 `attempting_until` | **45s** | 覆盖一次全量 fetch 的最坏耗时（Jira+GitLab 正常 5~15s）+ 余量 |
| 失败退避 | **15s** | 失败时不打同一台故障服务，但也不让人等太久 |

## 3. 判定：一条原子 UPDATE

SQLite 没有行锁，也拿不到 `SELECT ... FOR UPDATE`，所以"判断 + 抢"必须合成一条语句，靠 `changes()` 的结果决定谁取：

```sql
-- 常规路径：过期且空闲才抢
UPDATE fetch_state
   SET attempting_until = :now + 45000,
       last_attempt_at   = :now,
       owner             = :me
 WHERE scope = :scope
   AND attempting_until < :now
   AND (last_success_at IS NULL OR last_success_at < :now - 50000);

-- 手动刷新：忽略"是否过期"，但仍不允许踩别人正在取的那一脚
UPDATE fetch_state
   SET attempting_until = :now + 45000,
       last_attempt_at   = :now,
       owner             = :me
 WHERE scope = :scope
   AND attempting_until < :now;
```

- `changes() == 1` → 我取。取完在**同一个事务**里写事实 + `last_success_at = :now, attempting_until = 0, last_error = NULL`
- `changes() == 0` → 要么别人在取，要么数据仍新鲜 → **读库**，下一拍再看
- 失败 → `attempting_until = :now + 15000`（退避）、`last_success_at` **不动**、写 `last_error`。这保证"失败不会把旧数据标成新鲜"

## 4. 跟随者怎么知道有新数据

每 **3 秒**读一次 `PRAGMA data_version`（已实测：A 连接能看到 B 连接的提交，零查询）。值变了就：

1. 重读 `fetch_state` 里该窗口关心的 scope
2. 若 `last_success_at` 前进 → 重读事实表 → 按现有 `revision` 指纹决定要不要重绘

刷新延迟上限 = 3 秒。

## 5. 手动刷新

点"刷新" = 走上文第二条 UPDATE（忽略新鲜度）。抢不到就提示"另一个窗口正在刷新"，**3 秒后自动重试一次**（最多 3 次）。不做请求队列——排队会让"谁欠谁一次刷新"变成新的状态。

## 6. 失败矩阵

| 场景 | 行为 |
|---|---|
| 库文件不可写 / WAL 建不起来 | 退回**单窗口直连 + 内存态**（即现状），板内一行提示"共享库不可用，已退回单窗口模式" |
| 抢不到占位 | 读库（哪怕过期），下一拍再试；界面照常显示 `stale` |
| fetch 超时 | 按失败处理：退避 15s、保留旧事实、`last_error` 写成人话 |
| 窗口被强杀 | 无需处理：45s 后占位自然过期，别的窗口接手 |
| 窗口正常关闭 | best-effort 把 `attempting_until` 置 0（省一次 45s 空窗），失败也无所谓 |
| 机器时钟回拨 | 同机所有进程同一个钟，不做额外防护；只保证比较都在"同一个 now"上做 |

## 7. 和 03（schema）的接口

- 事实表的写入与 `last_success_at` 更新**必须同一事务**：否则会出现"数据是新的、时间戳还是旧的"（别人重复取）或反之（别人以为新鲜、其实没写进去）
- `fetch_state` 属于 02，事实表属于 03；03 的迁移不得改动本表语义
- 每条事实带自己的服务端时间戳（`created_at` / `merged_at` / build `timestamp`），`fetch_state` 只表达"我什么时候去问过"
