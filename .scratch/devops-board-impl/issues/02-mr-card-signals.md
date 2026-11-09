# 02: MR 卡信号：冲突上卡面，未解决讨论进详情

**What to build:** 有冲突的 MR 在卡面直接显示红字「有冲突」；点开详情能看到「N 条未解决讨论」。不用去 GitLab 才知道这个 MR 需要我改。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 有冲突的 MR 卡面显示红字，无冲突时不显示
- [x] 详情显示未解决讨论条数；字段缺失时显示"未知"，不能当成 0
- [x] 不新增对外请求（两个字段由 MR 列表接口直接返回）
- [x] 单测：未知 ≠ false ≠ 无问题

## Comments

- 列表接口只给 `blocking_discussions_resolved`（布尔），**不给条数**；要条数得额外请求 `/discussions`，与「不新增对外请求」矛盾。因此详情写三态：有未解决讨论 / 讨论已全部解决 / 未知，不编造数字。
- `MrCard.hasConflicts` / `blockingDiscussionsResolved` 均为 `boolean | null`，`null` 表示服务端没返回；卡面只在 `=== true` 时出红字「有冲突」。
- 同一响应里顺带把这两个字段填进 `GitLabMr`（Jira 板那条链），供 07 入库。提交 `7d17929`。

