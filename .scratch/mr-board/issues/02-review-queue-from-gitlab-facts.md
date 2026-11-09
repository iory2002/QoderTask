# 02: Review Queue：从 GitLab 事实到待审卡片

**What to build:** 打开 `GitLab Board` 就能看到真实存在于 Review Queue 里的 MR：reviewers 包含我、目标分支匹配、我还没批准、且仍是 opened。在 GitLab 里点下 Approve，下一轮刷新这张卡就从队列里消失。取数失败时保留上一份成功数据，只把过期/错误翻到界面上。

**Blocked by:** 01（PC Board 与 GitLab Board 骨架）

**Status:** implemented

- [ ] 当前用户身份通过 `/user` 取得并在会话内缓存，不每轮重复请求
- [ ] 每个 scope 条目并发发一条 reviewer 列表请求（`reviewer_id` + `target_branch` + `state=opened`），本地再按 `reviewers[].id` 复核一次
- [ ] 只收 `opened`：`merged` 不显示；`closed` 不进列但计入关闭数
- [ ] Draft MR 完全不可见，不占列也不参与计数
- [ ] 我已在 `/approvals` 的 `approvedBy` 里 → 该 MR 不出现在任何列
- [ ] `/approvals` 取数失败 → 卡片仍留在队列，徽章显示 `审批未知`，绝不显示成 `未审`
- [ ] 卡片显示 `!iid`、标题、作者、源分支 → 目标分支、最后更新时间
- [ ] 队列按最后更新时间倒序，时间相同时按 iid 倒序
- [ ] 列表或审批取数失败时保留上一份成功数据，显示 stale 与错误条幅；首次失败时显示错误而不是空队列
- [ ] 分类器的单元测试覆盖：merged 丢弃、closed 计数、Draft 丢弃、我批过出列、审批未知保留、排序、服务端过滤失效时的本地复核

## Comments

- 2026-11-07：`GitLabService` 新增 `/user`、`listMrsForUser(reviewer|author, opened|closed)`、`getMrDiffs`；`MrBoardResolver.classify` 承担全部列归属与过滤规则；`/approvals` 增加 `approvedByIds` 用于判断「我批过没有」。
- 真实探针（只读，`scratch/mr-board/probe-mr-board.js`）验证：`reviewer_id` 过滤生效（opened=0、closed=4，返回行均含 viewer id 8203）；`draft` 字段可用；`/approvals` 与 `/merge_requests/:iid/diffs` 均可用（示例 diff 14 KB，含补上的 `--- a/` / `+++ b/` 文件头）。
- 分类器单测覆盖全部规则（`test/mr-board-resolver.test.ts`）；`npm test` 61 项全绿。
- 待 IDE 内验收：卡片渲染与「批完下一轮出列」的端到端观察。
