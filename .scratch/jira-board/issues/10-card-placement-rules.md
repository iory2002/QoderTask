# 卡片归属：列外状态与 Sub-task

Type: grilling
Status: resolved

## Question

实测数据里有两类卡片无处安放，必须在设计阶段决定，而不是实现时顺手丢弃。

- **列外状态**：22 个状态中 7 个不在任何 board 列里——`Closed`、`Done`、`Reopened`、`Blocked`、`Updating`、`Backlog`、`TODO`。本 sprint 恰好 0 条，但 `Blocked` 是 To Do 类别的常用状态，随时会出现。选项：丢弃（数据丢失，且用户不知道有这张卡）、放进最近的同类列、聚到一个「未映射」列并显示原状态名、或在顶部用一条横幅提示「N 张卡的状态不在看板列中」。
- **Sub-task**：本 sprint 112 条里有 15 条 Sub-task。Jira 看板默认不显示子任务；全量渲染会出现父子重复，且子任务往往没有独立 MR/构建，阶段永远是「未提交」。

需要定的：

- 列外卡片的落点，以及它能否被拖拽（拖拽需要合法 transition，列外状态的出口未知）。
- Sub-task 是否整体排除（并说明依据），还是折叠在父卡片内。
- 若排除 Sub-task，JQL 用 `issuetype not in subTaskIssueTypes()`，还是要按 `parent is EMPTY`。
- 这两条规则是否需要可配置（不同项目习惯不同）。

## 已知事实

见 [research/02-jira-api-contract.md](../research/02-jira-api-contract.md) §1 与 §5。

## Answer

> 修正：原题里「子任务往往没有独立 MR，阶段永远未提交」的推论是错的——子任务有**独立 workflow**，能 `In Progress --Resolve--> Resolved`（Done 列）。

**1. Sub-task：保留，不排除。**

- 实测本 sprint 15 条：Open 11 / In Progress 3 / Cancelled 1，是真实工作量。
- 它有独立 workflow：`Resolve` → Resolved、`Revert` → Open、`Cancel` → Cancelled。
- 阶段徽章：子任务自己几乎不会有 MR（分支名通常用父任务 key），所以**阶段从父任务继承**，并在卡上标一个「子」角标；父任务无阶段时显「无法判定」。

**2. 列外状态：不进看板，但必须报数。**

- 7 个不在任何列的状态（Closed / Done / Reopened / Blocked / Updating / Backlog / TODO）的 issue **不渲染成卡片**。
- 顶栏显示一条可展开的提示：「N 张卡的状态不在看板列中（Blocked 2、Backlog 1 …）」，点开列出 key 并可跳 Jira。
- 这样既不弄脏看板，也不会静默吞掉数据。

**3. JQL 不排除 Sub-task**，只排除 Epic（Epic 不当卡片）。
