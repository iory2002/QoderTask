# 02 多实例共用一个库：谁是「活跃实例」，租约怎么交接

Type: grilling
Status: resolved
Blocked by: 01

## Question

事实库共享之后，刷新权必须唯一，否则多开窗口等于多倍请求，而且会互相覆盖。需要把协调协议定死：

1. **「活跃」怎么判定**？候选：a) 有看板面板可见（`setVisible(true)`）的实例；b) 最近一次有人操作的实例（window focused）；c) 谁先启动谁活跃。多个实例都满足条件时怎么收敛（先到先得 / 序号最小 / 手动指定）。
2. **租约形态**：库里的 `lease` 行（holder_id + expires_at + heartbeat_ms）够不够？租约多长（建议 90s，覆盖一次最长轮询 + 两次心跳）？持有者崩掉后多久被别人接管，接管时要不要先清掉半途数据。
3. **轮询节奏归谁**：租约持有者按面板可见性选间隔（现有 `pcBoard.pollIntervalSec` / badge 间隔），非持有者**完全停止**对外请求，只读库。两个板（Jira / GitLab）是各持一个租约，还是同一个租约覆盖两边？
4. **手动刷新的语义**：非持有者点了「刷新」怎么办？候选：a) 抢租约（原持有者被降级）；b) 只在库里写一个 `refresh_requested_at`，持有者下一拍看到就立刻刷；c) 忽略并提示"由另一个窗口刷新中"。要定：抢租约会不会导致两边来回抖动（防止 ping-pong）。
5. **感知变化**：非持有者怎么知道库里更新了？候选：a) 每 N 秒 `SELECT max(updated_at)`；b) 文件 mtime 变化（`fs.watch`）；c) 本地 IPC / 命名管道。要定刷新延迟上限（建议 ≤5s）与空闲 CPU 预算。
6. **降级路径**：租约永远抢不到（比如另一个实例假死）时，用户能不能一键"强制接管"？库不可写（只读盘 / 权限）时退回什么模式（单实例直连 + 内存态，即现状）？

## 完成标准

协议写成 `research/02-coordination-protocol.md` 或直接进 ADR：状态机（idle / leader / follower / takeover）+ 表结构 + 每个失败场景的行为。这条决定了"多开不再重复抓取"能不能真的成立。

## Answer

**2026-11-10 定稿，完整协议见 [research/02-coordination-protocol.md](../research/02-coordination-protocol.md)。**

**不做 leader、不做租约选举**。改成“新鲜度时间戳 + 短期占位”：任何窗口发现某个 scope 已过期、且没人在取，就由它去取。

- **粒度**：`fetch_state(scope, last_success_at, last_attempt_at, attempting_until, owner, last_error)`；scope = `jira:<boardId>` / `gitlab:<project>@<branch>`
- **判定**：一条原子 `UPDATE … WHERE attempting_until < :now AND last_success_at < :now - 50000`，靠 `changes()` 结果决定谁取（SQLite 无行锁，这是唯一不互相踩的写法）
- **三个数字**：TTL **50s**、占位 **45s**、失败退避 **15s**
- **写入原子性**：事实与 `last_success_at` 必须同一事务；失败时 `last_success_at` **不动**（不能把旧数据标成新鲜）
- **跟随者感知**：每 3s 读 `PRAGMA data_version`（实测可跨连接感知提交，零查询），变了才重读
- **手动刷新**：忽略新鲜度去抢占位；抢不到提示“另一个窗口正在刷新”，3s 后重试（最多 3 次），**不做请求队列**
- **降级**：库不可写 → 退回单窗口直连 + 内存态，板内提示一行
- **崩窗口不需要接管**：占位 45s 自然过期

由此作废了建图时写的“活跃实例 / 刷新租约”设想（GLOSSARY 里的 `Active instance` 已换成 `Fetch stamp`）。
