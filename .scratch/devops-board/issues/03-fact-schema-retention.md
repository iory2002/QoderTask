# 03 事实库的 schema 与保留策略

Type: grilling
Status: resolved
Blocked by: 01

## Question

库要存什么、留多久、怎么截断。必须先把"事实 vs 派生"划清，否则多实例下会出现两份互相矛盾的结论。

1. **事实表**：`issue`（key、sprint、status、type、assignee、updated、rank）、`mr`（project、iid、state、created_at、merged_at、merge_commit_sha、author、target_branch、updated_at、draft）、`approval`（mr、approver、approved_at、来源 endpoint）、`build`（job、number、result、timestamp、duration、sha、url）、`epic`。哪些字段是必存、哪些算派生（阶段、徽章数字、指标）。
2. **派生状态的归属**：阶段（Delivery Stage）和角标数字是**每次从事实现算**，还是也落表？建议现算——避免库里的结论和事实打架；但要定缓存键（revision/指纹）免得每次重算导致重绘。
3. **保留与截断**：MR 列表现在只拉 90 天、最多 3 页。库里保留多久（90 天 / 一年 / 永久）？超出窗口的事实永远拿不回来——要明确"指标从哪天开始可信"，并在指标上标注数据起点。
4. **一次性 vs 增量**：每次刷新是"全量覆盖当前 sprint 的 issue"还是"upsert 增量"？MR / build 是全量拉还是按 `updated_after` 增量。
5. **体积与清理**：估算一年后的行数与文件大小；要不要定期 `VACUUM`、要不要按 job 裁剪旧 build（构建每天 2 次，一年 ~700 行/分支，可忽略）。
6. **schema 版本**：迁移脚本放哪（扩展启动时跑 / 单独命令）、回滚策略。

## 完成标准

schema DDL + 保留规则 + 迁移策略写进 `research/03-schema.md`，并回答"指标的起点是哪天"。

## Answer

**2026-11-10 定稿，完整 DDL 见 [research/03-schema.md](../research/03-schema.md)。**

- **只存事实**：`meta` / `board` / `sprint` / `issue` / `mr` / `mr_approval` / `build`（+ 02 的 `fetch_state`）。阶段、`buildFailed`、角标、`evidence`、`revision` **一律不落库**，每次从事实现算。
- **不存的字段**：`mr.description`（只用来匹配 Jira key，匹配完即弃）；`issue.priority` 保留（卡面 chip 的唯一来源）。
- **写入方式**：Jira / GitLab 按 scope **全量替换**（单一事务，500 行 1ms）；`build` 用 **UPSERT**（历史账本，每 job 留最近 200 条）。
- **保留**：`mr` / `mr_approval` 永久；`issue` 只留当前 sprint；`sprint` 最近 10 条。全库一年 < 5MB。
- **指标起点**：`meta.first_seen_at` 建库时写入，界面必须显示“自 <日期> 起”（90 天窗口外的事实补不回来）。
- **维护**：每次成功写入后 `wal_checkpoint(TRUNCATE)`；`VACUUM` 只在“删过行且 > 20MB”时做。
- **迁移**：`user_version` 顺序迁移 + 迁移前 `.bak`；库版本高于代码 → 只读 + 退回单窗口，**不降级迁移**；损坏则重命名为 `facts.corrupt-<ts>.sqlite` 并重建。
- **留给 04**：`mr_approval.approved_at` 可为 NULL（approve 时间戳能否拿到待 04 确认）。
