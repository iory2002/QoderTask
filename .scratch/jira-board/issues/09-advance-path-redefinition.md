# 推进点重定义：真实链路有 In Review 这一环

Type: grilling
Status: resolved

## Question

实测的 workflow 是 `Open --Start--> In Progress --Review Code--> In Review --Send to Test--> In Test --Pass--> Pending Release`，**没有 `In Progress → In Test` 的直达 transition**；而本 sprint 里 `In Review` 的 issue 数是 0，这一列在设计上是通往 In Test 的唯一入口，在数据上却长期是空的。

需要定的：

- **是否允许复合跳转**：拖到 In Test 时，若当前在 In Progress，是否自动串行执行 `Review Code` + `Send to Test` 两次写？还是拒绝并提示「先拖到 In Code Review」？串行意味着两次可能各自带必填表单，且第二步失败时第一步已生效——这是半个事务。
- **徽章推送的语义**：`阶段达标 → 推送 In Test` 是否也走复合跳转，还是只对已位于 In Review 的卡片可用。
- **In Code Review 空列怎么处理**：常驻空列（诚实但占地方）、自动隐藏、还是折叠成细条。
- **如果团队实际不走 In Review**（reviewer 在别处操作），这条 workflow 是否还会变——spec 要不要写成「按 transitions 动态找路径」而不是硬编码链路。
- **回退路径**：`Return` / `Fail` 这类回退 transition 是否也允许拖拽触发（拖回左列），还是只允许前进。

## 为什么它挡路

它决定拖拽的合法性判定（是「列可放」还是「transition 存在且路径可达」），也决定 08 号票的期数切分。

## 已知事实

见 [research/02-jira-api-contract.md](../research/02-jira-api-contract.md) §2 与 §3。

## Answer

> ⚠️ **本节已根据 §9 实测修正。原答案建立在错误前提上**（当时只看了 `NEX2-980` 一个 Story 样本就断言“没有直达”，实际上 Bug/Task 就是直达）。

**真实规矩：不存在全局单链，合法目标列由该 issue 自己可用的 transitions 决定。**

实测（同样是 `In Progress`，不同 issue type 出口完全不同）：

| Type | 可用出口 |
|---|---|
| Story | `Review Code` → In Code Review；`Return` → Open |
| Bug | `Send to Test` → In Test；`Revert` → Open |
| Task | `Resolve` → Resolved（Done 列）；`Send to Test` → In Test |
| In-Sprint Bug | `Send to Test` → In Test |
| Sub-task | `Resolve` → Resolved（Done 列） |

四条决定：

1. **拖拽合法性 = 「该 issue 当前可用的 transitions 里存在 to.statusId ∈ 目标列」**，与列是否相邻无关。Bug 拖去 In Test 合法；Task 拖去 Done 合法；Story 拖去 In Test 不合法（只能先到 In Code Review）。
2. **不做复合跳转**（仍然成立）：每次只执行用户选中的那一条 transition，不自动串联。
3. **单向**：回退（`Return` / `Revert` / `Fail`）不支持拖拽，去 Jira 网页做。
4. **列永远常驻**：In Code Review 只会在 Story 上出现，但它不隐藏。

推进闸门：阶段达标（approve 或 merged）时在卡片上给出推荐目标列，但最终仍由用户拖拽决定；未达标拖入走软闸门。
