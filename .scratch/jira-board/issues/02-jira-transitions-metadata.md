# Jira transitions 与必填字段的真实形状

Type: research
Status: resolved

## Question

「拖拽 → 拉 transitions → 填必填字段 → POST」这条链里，Jira REST API 到底返回什么、要求什么？需要拿真实响应定下 payload 契约。

要确认的：

- `GET /rest/api/2/issue/{key}/transitions?expand=transitions.fields` 的返回结构：`transitions[].id`、`name`、`to.statusId`，以及 `fields` 里每个字段的 `required`、`schema.type`、`allowedValues` 形状。
- 常见必填字段类型各长什么样：`string`、`number`、`option`（单选）、`array`（多选）、`date`/`datetime`、`user`。
- `POST /rest/api/2/issue/{key}/transitions` 的 payload：`transition.id` + `fields` 混填、`update` 操作、以及在带 `screen` 时缺字段的 400 响应结构（`errors` 字段级报错长什么样）。
- `GET /rest/agile/1.0/board/{id}/configuration` 的 `columnConfig.columns` 结构，以及每列 `statuses[]` 里的 `id`/`self`。
- JQL 从「排除 Done」改为「包含整个 sprint」后，`/rest/api/2/search` 的分页行为（`startAt`/`total`/`maxResults` 上限）。
- Jira Server/DC 8.x 与 Cloud 的差异点（本环境是 Server，仍列出差异以免把 Cloud 写法写进 spec）。

## 交付

一份端点契约清单：请求样例、响应样例、错误样例。它是必填字段表单设计票的前置。

## Answer

完整数据见 [research/02-jira-api-contract.md](../research/02-jira-api-contract.md)（可重跑探针 `research/probe-jira*.js`）。

五条结论：

1. **列定义可用**：`columnConfig.columns` 返回 5 列 + 各自 statusId（To Do=1,10701 / In Progress=3,10700 / In Code Review=10101 / In Test=10401 / Done=10500,10600,10601,10302,5）。共 22 个状态中 **7 个不在任何列**（Closed / Done / Reopened / Blocked / Updating / Backlog / TODO）。
2. **真实链路不是「In Progress → In Test」**：实测 `Open --Start--> In Progress --Review Code--> In Review --Send to Test--> In Test --Pass--> Pending Release`，没有直达 transition。
3. **每次写都要过表单**：所有 transition 都把 `summary` 列为必填；NEX2 项目的 `Start` 有 8 个必填项。且 `fields.*` 不携带当前值 —— **预填必须读 issue 自身字段**。
4. **一次拉得完**：`maxResults=500` 被接受并真的返回 112 条，不必分页。现行 JQL 只拿到 5 条（丢掉 95%），且 Done 列必空。
5. **字段现成**：`Epic Link=customfield_10000`、`Rank=customfield_10005`（排序直接用）、`Sprint=customfield_10004`；构造号只能来自 Jenkins（Jira 的 Build 字段实测全 null）。

连带产生两张新票：「推进点重定义」与「卡片归属规则」（列外状态 + Sub-task）。
