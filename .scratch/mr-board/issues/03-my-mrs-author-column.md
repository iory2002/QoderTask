# 03: My MRs：author 列与审查状态

**What to build:** 第二列 `我提交的` 只放 author 是我的 opened MR，不受 assignee 字段影响；卡片用徽章表达 Review State：`未审`、`已审（N 人）`。MR 被合入后从看板消失；被关闭未合入的不进列，只在顶栏累加提示。

**Blocked by:** 02（Review Queue：从 GitLab 事实到待审卡片）

**Status:** implemented

- [ ] 每个 scope 条目并发发一条 author 列表请求，与 reviewer 结果按 iid 去重
- [ ] 只按 author 判定：assignee 是我但 author 不是我的 MR 不出现
- [ ] 卡片徽章：`approvedBy` 里有我以外的人 → `已审（N 人）` 并展示批准人；否则 `未审`
- [ ] 同一 iid 同时满足两列时只进 `Reviewer 包含我`，不重复
- [ ] 两列各自独立按更新时间倒序
- [ ] 合入后的 MR 在下一轮刷新时从两列消失
- [ ] 顶栏显示「另有 N 个已关闭」，N 为两个 scope 内 closed 的合计数
- [ ] 分类器测试补齐：author 判定、`已审 / 未审`、双列去重、两列独立排序、合入退场

## Comments

- 2026-11-07：第二列按 `author.id === viewer.id` 取数；`未审` / `已审（N 人）` 由 `/approvals` 的 `approvedByIds` 计算；同一 iid 命中两列时只进队列；closed 由额外的 closed 查询累加，merged 不拉取也不显示。
- 真实探针：`author_id` 过滤生效（opened=1、closed=5，closed 含 draft 行，分类器会在计数前丢弃）。
- 单测覆盖 author 判定、双列去重、排序与合入退场；`npm test` 61 项全绿。
- 待 IDE 内验收：两列真实数据、合入后下一轮消失、顶栏「另有 N 个已关闭」。
