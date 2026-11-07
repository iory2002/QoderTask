# 02 结论：Jira 端点契约（实测，非文档推断）

环境：Jira Server `http://10.191.47.24:8080`，Board 23，活跃 sprint 521，全部请求 HTTP 200。
探针脚本：`research/probe-jira.js` ~ `probe-jira-4.js`（只读，可重跑）。

## 1. Board 配置：5 列，但有列外状态

`GET /rest/agile/1.0/board/23/configuration` → `columnConfig.columns[5]`

| 列 | 包含的 statusId |
|---|---|
| To Do | 1 (Open), 10701 (Waiting for Feedback) |
| In Progress | 3 (In Progress), 10700 (Investigating) |
| In Code Review | 10101 (In Review) |
| In Test | 10401 (In Test) |
| Done | 10500 (Ready for Review), 10600 (Pending Release), 10601 (Released), 10302 (Cancelled), 5 (Resolved) |

同时返回 `ranking.rankCustomFieldId = 10005`，即 **Jira Rank 就是 `customfield_10005`**，值形如 `"0|i06g00:"`（LexoRank，可直接按字符串升序排）。

**全库 22 个状态中，有 5 个不在任何列里**：`6=Closed`、`10001=Done`、`4=Reopened`、`10301=Blocked`、`10800=Updating`、`10801=Backlog`、`10300=TODO`。落在这些状态的 issue 没有列可放——本 sprint 恰好 0 条，但这是随时会发生的边界。

## 2. 真实 workflow 链路（**已修正，见 §9：workflow 按 issue type 分化**）

实测每条 transition 的 `id / name / to`：

```
Open ──"Start"(11)──────────> In Progress
In Progress ──"Review Code"(151)──> In Review      ← 仅 Story
            └─"Return"(141)──────> Open
In Review ──"Send to Test"(21)────> In Test
          └─"Return"(161)────────> In Progress
In Test ──"Pass"(31)──────────────> Pending Release
        └─"Fail"(41)──────────────> In Progress
```

> ⚠️ 上面这张图只对 **Story** 成立。早期结论「不存在 `In Progress → In Test` 直达」是**错的**，因为样本 `NEX2-980` 恰好是 Story。以 §9 为准。

> ~~**不存在 `In Progress → In Test` 的直达 transition。**~~ ❌ 已推翻，见 §9。

另一个现场事实：本 sprint 里 `In Review` 的 issue 数为 **0**（全局有 117 条，均不在本 sprint）。对 Story 而言它是通往 In Test 的入口；对 Bug / Task 不是（它们直达）。

## 3. 必填字段：每次写都要过表单，且随项目/类型变化

| 起点 | transition | 屏幕字段 | 必填 |
|---|---|---|---|
| Open (NEX2 项目) | Start | 28 | **8**：issuetype, summary, customfield_11900, versions, customfield_12100, customfield_12202, customfield_12200, customfield_12201 |
| Open (PQ 项目) | Start | 5 | **1**：summary |
| In Progress | Review Code | 10 | 1：summary |
| In Review | Send to Test | 13 | 1：summary |
| In Test | Pass | 9 | 1：summary |

结论：

- **必填字段集随项目与 issue type 变化**，硬编码任何字段名都会在另一个项目上 400。必须逐 issue 动态拉 `transitions?expand=transitions.fields`。
- `summary` 几乎总在屏幕里且必填，但 `fields.summary` **不携带当前值**（探针输出 `(无预置值)`）。所以**预填必须从 issue 自身的字段读，不能指望 transitions 元数据**。
- NEX2 的 `Start` 要填 8 个必填项，其中 `issuetype`、`versions` 等属结构性字段——这类字段如果当前值已满足，仍会出现在表单里。设计要点：**表单默认填满当前值，用户一路回车即可**，否则从 Open 开始拖动会变成灾难。

## 4. 搜索与分页

- 现行 JQL（`status not in (Resolved, Closed, Done)` + `assignee = currentUser()`）→ **total = 5**
- 全 sprint → **total = 112**（状态分布：Open 54 / In Progress 22 / In Test 8 / Pending Release 8 / Cancelled 6 / Resolved 2）
- 现在只拉 5 条，等于丢掉了 95% 的数据；且 Done 列必然为空——实证了 map 里的那条一致性约束。
- `maxResults=500` **被接受并真的返回 112 条**（回显 500）；`startAt=100` 正常返回剩余 12 条 → 一次请求拉完可行，不必分页。

## 5. 字段与数据质量

- `customfield_10000 = Epic Link`（any），`customfield_10005 = Rank`，`customfield_10004 = Sprint`（array）——三者在一次 search 中可批量取回。
- Epic 填充率：**有 33 条 / 无 79 条**（约 70% 无 epic）。按 epic 分泳道会有一大坨「无 Epic」。
- issue type 分布：`Bug 44, Story 24, Task 20, Sub-task 15, In-Sprint Bug 9`。**Sub-task 占 15 条**——Jira 看板通常不显示子任务，若全量渲染会出现父子重复。
- Jira 侧虽有 `customfield_10102 = Build`、`customfield_12300 = Verify Build Number/s`，但样本 issue 取值均为 `null`（`Build` 甚至未返回）→ **不可作为构建号的事实源**，构建预填只能来自 Jenkins。

## 6. 对原设计的推翻与约束

1. 「一次推进 In Progress → In Test」不成立（见 §2），推进点需要重新定义。
2. 「必填项」不是偶发情况，而是**每次写都有**，表单是主路径不是分支路径。
3. 预填来源是 **issue 当前字段值**（必填项自洽），外加 MR/build 事实；不能来自 transitions 元数据。
4. 需处理 **列外状态** 与 **Sub-task** 两类卡片归属问题。
5. Jira 服务是 http:8080，`JiraService` 现有 `port || 80` + `http` 模块能跑，但一旦换到 https 实例即失效（GitLabService 已有 https 分支可参照）。

## 7. Board 范围与「泳道」真相（probe 5~7）

- Board 23 = `Software All-in-One Board`（scrum），filter 14301 的 JQL 覆盖 7 个项目（ATD, IB, VCP, MAGR3, PQ, NEX, NEX2），且 `ORDER BY Rank ASC`；**该 JQL 还包含 Epic 类型与 Sub-task**，照搬会冒出 Epic 卡片。
- 活跃 sprint = **521 `Sprint (11.18)`**（2026-11-05 ~ 2026-11-19），共 112 条，其中 NEX2 项目 87 条。
- 用户在 Jira 上截图的那块看板：`sprint = 521 AND assignee = currentUser()` 恰好 **total = 6**，且这 6 个 key 与截图逐一对上。所以「泳道头 NEX2 / 6 issues / Nexus R2」是 **按项目分组**（NEX2 = 项目 key，Nexus R2 = 项目名），不是 epic 泳道。
- 结论：插件默认视图 = 活跃 sprint ∩ 我 = 6 张；关掉「只看我的」才看到 112 张全貌。
- 卡片上那个橙色 chip 已定位为 **Epic**（`NEX2-775`「OB GYN Workflow」），不是 component。
- 踩坑记录：`customfield_10004`（Sprint）返回的是 Java 对象的 toString 字符串，不是 JSON，解析时不能当对象读 `name`；要判断归属直接用 JQL `AND sprint = <id>` 反查。

## 8. 项目范围（probe 8）

用户实际关注的 4 个项目：`MAGR3 / NEX / NEX2 / IB`。sprint 521 内分布：

| 项目 | 条数 |
|---|---|
| NEX2 | 87 |
| MAGR3 | 11 |
| NEX | 8 |
| IB | 4 |
| PQ | 1（不在范围） |
| ATD | 1（不在范围） |
| VCP | 0 |
| 合计 | 112 |

结论：项目过滤候选写死为这 4 个（或配置项默认值），共 110 条；PQ/ATD 的两条零头自然被排除。「只看我的」= 6 条，全在 NEX2。

## 9. 修正：workflow 按 issue type 分化（决定性）

同样的 `In Progress` 状态，不同 issue type 的出口完全不同：

| Type | In Progress 的出口 |
|---|---|
| **Story** | `Review Code` → In Code Review；`Return` → Open |
| **Bug** | `Send to Test` → In Test；`Revert` → Open |
| **Task** | `Resolve` → Resolved（**Done 列**）；`Send to Test` → In Test；`Revert`；`Cancel` |
| **In-Sprint Bug** | `Send to Test` → In Test |
| **Sub-task** | `Resolve` → Resolved（**Done 列**）；`Revert`；`Cancel` |

推论（推翻 09 号票原来的答案）：

1. **「不存在 In Progress → In Test 直达」是错的**。Bug / Task / In-Sprint Bug 都直达；Task 与 Sub-task 甚至能一步跨到 Done 列。
2. **不存在全局的单链推进模型**。合法目标列只能由该 issue 当前可用的 transitions 决定，不能按列相邻性推。
3. **Sub-task 有独立 workflow**，且本 sprint 的 15 条子任务里 11 条 Open、 3 条 In Progress、1 条 Cancelled——它们是真实工作量，不能排除。
4. 方法论教训：用**单一样本**推断 workflow 是错的，必须按 issue type 分组抽样，或干脆逐 issue 拉 transitions。
