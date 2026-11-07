# 03: 卡片渲染与范围控制

**What to build:** 列里出现真实卡片，按 Jira Rank 排序；顶部能按项目筛，并能切「只看我的」。这是第一次能拿它跟 Jira 看板并排对照。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] 「只看我的」打开时显示自己的卡片（当前 sprint 是 6 张），关掉后显示项目白名单内全部卡片（当前是 110 张）
- [ ] Done 列不为空：处于 Resolved / Pending Release 等 Done 状态的 issue 出现在 Done 列
- [ ] 卡片顺序与 Jira 看板一致（按 Rank 升序），不是按更新时间
- [ ] 卡片显示 key、标题（最多三行）、优先级、Epic 标签（仅有 Epic 时才显示）、评论数
- [ ] Epic 类型本身不作为卡片出现
- [ ] 取消勾选某个项目后，该项目的卡片立即消失，计数同步更新
- [ ] 卡片上的 key 点击可在浏览器中打开对应 Jira issue