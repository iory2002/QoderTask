# 03: 卡片渲染与范围控制

**What to build:** 列里出现真实卡片，按 Jira Rank 排序；顶部能按项目筛，并能切「只看我的」。这是第一次能拿它跟 Jira 看板并排对照。

**Blocked by:** 02

**Status:** resolved

- [x] 「只看我的」打开时显示自己的卡片（当前 sprint 是 6 张），关掉后显示项目白名单内全部卡片（当前是 110 张）
- [x] Done 列不为空：处于 Resolved / Pending Release 等 Done 状态的 issue 出现在 Done 列
- [x] 卡片顺序与 Jira 看板一致（按 Rank 升序），不是按更新时间
- [x] 卡片显示 key、标题（最多三行）、优先级、Epic 标签（仅有 Epic 时才显示）、评论数
- [x] Epic 类型本身不作为卡片出现
- [x] 取消勾选某个项目后，该项目的卡片立即消失，计数同步更新
- [x] 卡片上的 key 点击可在浏览器中打开对应 Jira issue

## Comments

- JQL：`sprint = <active> AND project IN (<白名单>) AND issuetype != Epic [AND assignee = currentUser()] ORDER BY Rank ASC`。之前那条 `status not in (Resolved, Closed, Done)` 已彻底删除——它让 Done 列永远为空。
- 排序用 board configuration 返回的 `ranking.rankCustomFieldId`（本环境 `customfield_10005`）做**字符串字典序**升序，缺 rank 的排最后，同 rank 用 key 兜底。
- Epic chip 显示 Epic 标题：先批量用 `key IN (...)` 查一次 summary，结果按 key 缓存在内存里；查不到就退回显示 key。Epic Link 取 `customfield_10000`，兜底 `customfield_10014`。
- 项目过滤是**客户端立即生效**（卡片带 `project`），WebView 按 `scope.projects` 过滤，所以取消勾选立刻消失、计数立刻更新；「只看我的」是在 JQL 里改 `assignee = currentUser()`，需要重拉，重拉期间保留旧数据。
- 头像只在「只看我的」关闭时显示（此时卡片可能不是自己的）。
- 状态不在任何列的 issue 仍有卡片数据但不进列，顶栏显示「列外状态 N 条」，不静默丢弃。
- key 的点击 `stopPropagation` 后走 `card:openJira`，由扩展 `vscode.env.openExternal` 打开浏览器。
- 子任务保留为卡片，带「子」角标。
