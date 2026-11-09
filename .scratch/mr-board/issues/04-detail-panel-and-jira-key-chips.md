# 04: 详情浮层与 Jira key chip

**What to build:** 左键任意卡片弹出详情浮层，不离开编辑器就能回答「这个 MR 在交付什么、谁批了、分支怎么走」。卡片上带 Jira key chip，点击跳 Jira issue；没有 key 的 MR 照常显示，只是没有 chip。

**Blocked by:** 03（My MRs：author 列与审查状态）

**Status:** implemented

- [ ] 左键卡片弹出浮层，展示标题、Review State、源分支 → 目标分支、批准人名单（含还差几人）、创建与更新时间、Jira key 列表
- [ ] 浮层按 Esc 或点遮罩关闭；轮询更新时浮层内容跟着刷新且不抢焦点
- [ ] 浮层底部提供「在 GitLab 中打开」，走系统浏览器打开 MR web URL
- [ ] 卡片展示 Jira key chip；点击 chip 打开对应 Jira issue 页面
- [ ] 一个标题覆盖多个 issue（如 `NEX2-1038+1039`）时两个 key 都出 chip，前缀继承规则与 Jira 看板一致
- [ ] key 白名单与现有 Jira 看板一致；标题/描述/源分支都没有 key 时 `jiraKeys` 为空，卡片照常显示且浮层显示「无」
- [ ] 非 http(s) 链接一律拒绝打开

## Comments

- 2026-11-07：详情浮层（Esc / 遮罩关闭、轮询刷新不抢焦点）与卡片 Jira key chip 已落地；chip 复用 `extractJiraKeys`，白名单取 Jira 项目白名单 ∪ repos 声明的项目。
- 单测覆盖 `NEX2-1038+1039` 双 key 与「无 key 也显示」；`npm test` 61 项全绿。
- `openExternal` 与 Jira 看板共用同一份 http(s) 校验。
- 待 IDE 内验收：浮层布局、chip 点击跳转。
