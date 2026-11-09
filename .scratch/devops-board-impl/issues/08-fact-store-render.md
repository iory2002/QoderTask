# 08: 事实库 B：渲染改读库

**What to build:** 两个看板的渲染改为从库里读事实、现算阶段与角标。断网重开窗口时仍能看到上一次成功的数据，并正常显示过期标记。

**Blocked by:** 07

**Status:** resolved

- [x] 打开看板时若库中已有数据，先秒开显示，不等网络
- [x] 取数失败时保留旧数据并标为过期（与现在行为一致，但数据来源是库）
- [x] 阶段、`buildFailed`、角标、推导依据每次从事实现算，不读缓存结论
- [x] 两个板行为一致：Jira 板与 MR 板都走同一条"读库 → 现算 → 渲染"路径
- [x] 单测：给定一组事实，卡片阶段与角标的期望结果
- [x] 数据未变化时不触发重绘（沿用现有指纹机制）

## Comments

- `BoardState.start()` / `MrBoardState.start()` 先 `restoreFromStore()` 再走网络；恢复的数据一律 `stale: true`，顶栏显示「数据可能过期 · 时间 · N 张」。
- `applyStages` 拆成「取数」与「现算」两段（`applyResolvedStages`），恢复路径与网络路径共用后者，因此阶段/角标/依据只有一份推导逻辑。
- 恢复时没有网络 → 拿不到祖先判定，按时间窗退回（详情标「推断」）。
- **库里多存了几个服务端事实**：`mr.reviewer_ids` / `web_url` / `approved` / `approvals_left`。没有这四列，离线恢复既分不出 MR 板的两列，也分不出一张 MR「已批/未批」——它们是服务端原话，不是派生结论。
- MR 板的个人切片写 `gitlab-user:` scope（与分支全量分开），同样要存 `reviewer_ids` 才能恢复两列。
- 测试：`test/restore.test.ts`（事实 → 阶段/两列）、`test/fact-store.test.ts`（mr + 审批快照）。提交 `983ff5e`。

