# 05: GitLab 阶段徽章

**What to build:** NEX2 与 NEX 的卡片上出现交付阶段徽章：这张卡的代码走到哪一步了（没交 / 待审 / 已批准 / 已合入）。没接入代码托管的项目不出徽章，取数失败时显示「无法判定」而不是「未提交」。

**Blocked by:** 03

**Status:** resolved

- [x] 有已合入 MR 的 issue 显示「已合入」（可用 NEX2-932 验证：它有三个 MR，应指向最近合入的那个）
- [x] MR 已开且确实已批准时显示「已 Approve 待合入」；只有人按过 Approve 但 MR 仍未批准的，**不得**显示为已批准
- [x] MR 已开且未批准显示「MR 待审」
- [x] 关联不到任何 MR 显示「未提交」
- [x] GitLab 不可达或凭据失效时显示「无法判定」，并在顶部给出可解释的提示
- [x] MAGR3 / IB 的卡片不出现阶段徽章
- [x] 标题写作 `NEX2-1038+1039` 时，两张卡都能被关联上（不是只关联第一个）
- [x] 形如 `C1-6`、`L3-12` 的串不会被误认为 Jira key
- [x] 阶段判定逻辑有单元测试覆盖六种状态（含多 MR 取最高、批准失效的边界）

## Comments

- 三个纯函数拆开，全部可脱机单测：
  - `JiraKeyMatcher.extractJiraKeys()` —— 白名单正则（长 key 在前）+ `+1039` 前缀继承；
  - `MrAssociation.associateMrs()` —— 标题 → 描述 → 分支名的关联顺序，一个 MR 多个 key、一个 key 多个 MR 都支持；
  - `DeliveryStageResolver.resolveStage()` —— 事实 → 阶段，六态全覆盖。
- 请求形状：每个 repo 条目（`gitlabProject` + `targetBranch`）每轮**一条**列表请求（`state=all&target_branch=…&updated_after=90d`），只对 `state=opened` 的 MR 补 `/approvals`（并发上限 4），本地 join，绝不按卡片逐个查。
- 审批判据是 `/approvals` 的 `approved === true`；`approved_by` 在列表/详情接口里根本不存在，`detailed_merge_status` 一律不用。
- 「有无 repo 条目」就是追踪开关：MAGR3 / IB 没有条目 → `stage = null` → 卡片不出徽章；有条目但取数失败 → `unknown`。GitLab 整体未配置时也只影响追踪中的项目，并给出一条指向 `~/.scrumbuddy/config.json` 的横幅。
- 子任务：没有自己的 MR 时继承父任务的解析结果（父任务不在卡片集合里则「无法判定」）。
- 单测 33 条全绿，其中 14 条覆盖阶段阶梯（含「有 approver 但 approved=false」「更早的 SUCCESS 不算已构建」「进行中不算失败」）。
