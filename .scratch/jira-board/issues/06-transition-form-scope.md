# 必填字段表单的范围与预填规则

Type: grilling
Status: resolved

## Question

Jira 的 transition 常常带一个 screen，缺必填字段就 400。这个表单要做到什么程度才够用、又不至于变成「在插件里重写一遍 Jira」？

需要定的：

- **支持哪些字段类型**：`string`（单行/多行）、`number`、`option`（单选下拉）、`array`（多选）、`date`/`datetime`、`user`（人员选择）——每一类都是一种控件加一种序列化，逐类决定，不一句「都支持」带过。
- **预填规则**：哪些字段能从事实源自动填？例如 MR 链接填进「Related MR」、build 号填进「Build Version」、approver 名单填进 comment。预填靠字段名匹配还是配置显式声明（`todoPanel.transitionPrefill`）？配置化更可控但要多配一处。
- **评论**：写入时是否总是附带一条自动生成的 comment（含 MR 与 build 链接），还是让用户勾选。
- **校验与报错**：前端先校验（必填为空就禁用提交）还是交给 Jira 返回 400 再逐字段回填错误。Jira 的 `errors` 是字段级结构，回填成本低，倾向后者兜底 + 前者防手滑。
- **不可支持的类型**：遇到复杂字段（如 cascading select、自定义富文本）怎么降级——显示「请在 Jira 中完成此步骤」并给跳转链接，而不是静默失败。

## 交付

字段类型支持矩阵 + 预填规则 + 降级策略。它是分阶段落地票的前置。

## 已知事实（来自 02 号票的实测）

- 每次写都有必填项，表单是主路径不是分支：`summary` 在所有 transition 上都必填。
- NEX2 项目从 Open 出发的 `Start` 有 **8 个必填项**（issuetype / summary / customfield_11900 / versions / customfield_12100 / customfield_12202 / customfield_12200 / customfield_12201），PQ 项目同一个 `Start` 只有 1 个。
- transitions 元数据里的 `fields.*` **不携带当前值**，所以预填的数据源必须是 issue 自身的字段快照。
- Jira 的 `customfield_10102 = Build` 实测全为 null，构建号预填只能来自 Jenkins。

## Answer

**1. 字段类型支持**：`string`（单行/多行）、`option`（单选下拉）、`array`（多选）、`user`（人员）四类。其余类型（cascading select、富文本、`versions` 等）**不硬做**：表单顶部提示「此步骤含插件不支持的字段：X / Y」，禁用提交，给「在 Jira 中完成」链接。

**2. 预填**：全部字段用 **issue 当前字段快照**预填（transitions 元数据不带值），用户不改就直接可以提交；只把改过的字段放进 payload。这样 `Start` 的 8 个必填项大多数开箱即满。

**3. 评论**：**从不写**。只做状态转移，不在 Jira 上留自动评论。

**4. 校验**：前端在必填为空时禁用提交；同时保留 Jira 400 的字段级 `errors` 回填到对应控件（两道防线，后端为准）。

**5. payload**：`POST /rest/api/2/issue/{key}/transitions`，`{ transition: { id }, fields: { ...仅改动项 } }`。

**6. 不可支持的字段是硬阻断而非静默**：宁可让用户去 Jira 完成，也不发一个注定 400 的请求。
