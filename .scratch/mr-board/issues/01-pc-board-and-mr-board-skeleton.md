# 01: PC Board 与 GitLab Board 骨架

**What to build:** 从活动栏进入 `PC Board`，入口页同时给出「打开 Jira 看板」和「打开 GitLab 看板」；点活动栏图标仍然默认打开 `Jira Board`。`GitLab Board` 作为独立编辑器 tab 打开，里面是两块空列 `Reviewer 包含我` / `我提交的`，顶栏显示当前 MR Board scope 的仓库/分支 chip、同步时间与刷新按钮。MR Board 的配置与轮询骨架就位，但还没有任何真实 MR 数据。

**Blocked by:** None (can start immediately)

**Status:** implemented

- [ ] 扩展 displayName 与活动栏容器标题都是 `PC Board`，扩展 id 不变（已安装用户无需重装）；两块面板标题分别为 `Jira Board`、`GitLab Board`
- [ ] 入口页在「打开 Jira 看板」下面新增「打开 GitLab 看板」；点活动栏图标的行为保持不变
- [ ] 新命令打开 `GitLab Board` 编辑器 tab；重复触发复用同一个 tab 实例，不叠开
- [ ] 顶栏显示 `GitLab Board`、仓库/分支 chip（多条并列）、同步时间、刷新按钮
- [ ] 配置 `todoPanel.mrBoard.repos` 默认一条 `ultrasoundgeneralimaging/gipc-app @ nexus/dev/7.10.x`；`todoPanel.mrBoard.pollIntervalSec` 默认 90，钳制在 30–300
- [ ] 面板不可见时停止轮询，回到可见立刻刷新一次；轮询用递归定时器，不出现两轮重叠
- [ ] 首屏显示骨架屏而不是空列；两列都空时显示明确的空态文案
- [ ] GitLab token 未配置、或 scope 为空时给出可操作的 notice（指明去 `~/.scrumbuddy/config.json` 或设置项），绝不把「取不到数」显示成空列
- [ ] WebView 打包管线产出两个独立 bundle，两块看板各自只加载自己的脚本与样式

## Comments

- 2026-11-07：扩展改名 `PC Board`，新增 `todoPanel.openMrBoard` 与入口页第二个链接；`GitLab Board` 面板、独立轮询（`todoPanel.mrBoard.pollIntervalSec`，默认 90s）、骨架屏与配置型 notice 都已落地。
- 构建管线改为双入口：`media/board.js` 25.1 KiB、`media/mr-board.js` 24.1 KiB，`scripts/check-webview-build.js` 同时校验两个产物。
- 已验证：`tsc -p ./`、`tsc -p tsconfig.webview.json` 零错误；`npm test` 61 项全绿。
- 待 IDE 内验收：顶栏 chip 渲染、骨架屏 → 空态切换、切后台停表。
