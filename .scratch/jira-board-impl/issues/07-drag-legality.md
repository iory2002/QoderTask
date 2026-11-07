# 07: 拖拽合法性判定

**What to build:** 卡片可以拖了，但能拖到哪由这张卡自己在 Jira 里可用的动作决定——不是「相邻列就能放」。放不下的时候说清楚为什么、该去哪。此阶段还不写 Jira。

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Bug 从 In Progress 拖到 In Test 可以放下（这是 Jira 里真实存在的动作）
- [ ] Story 从 In Progress 拖到 In Test 被拒绝，并提示只能先推到 In Code Review
- [ ] Task 可以直接拖到 Done（对应它在 Jira 里的 Resolve）
- [ ] 往回拖（例如 In Test 拖回 In Progress）被拒绝，提示回退要到 Jira 网页操作
- [ ] 拖拽过程中，不可放的列有明确的视觉区别（不是拖到上面才报错）
- [ ] 每次拖拽前重新获取该卡可用的动作，不跨交互复用旧结果
- [ ] 拖放成功后卡片不移动（本阶段只做判定，不落状态），并有「这一步还不能写」的明确提示