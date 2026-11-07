# 01: 工作区看板骨架

**What to build:** 点活动栏图标，编辑器区打开一个「Jira Board」tab，里面是一个空看板。前端代码从独立 `.js` 文件加载（不是塞在模板字符串里），打包链路跑通。此阶段旧的侧边栏面板仍然可用。

**Blocked by:** 00

**Status:** resolved

- [x] 点活动栏图标 → 编辑器区出现 tab；再点一次聚焦同一个 tab，不重复开
- [x] WebView 里的脚本确实来自打包产物（例如产物在启动时设置一个可读的标记），不是内联在 HTML 模板里
- [x] 重载窗口后 tab 行为正常，无脚本报错、无 CSP 违规
- [x] 打包产物缺失或为空时，`npm run package` 直接失败，不产出 vsix
- [x] 旧的侧边栏 TODO 面板此时仍可正常打开（并存期不回归）

## Comments

- 入口链路：活动栏容器 `jira-board` → webview 视图 `jiraBoard.entry` → `resolveWebviewView` 里调用 `BoardPanel.createOrShow()`。重复点击走 `reveal()`，不会开第二个 tab。
- 标记：`window.__JIRA_BOARD_BUNDLE__ = 'board-webview@1'`，同时写在 `#board-root` 的 `data-bundle` 属性上；已确认 `media/board.js` 里存在该字符串。
- 脚本只通过 `<script nonce=... src=".../media/board.js">` 加载，HTML 模板里没有任何内联 JS；CSP 用 nonce 而非 `unsafe-inline`。
- `npm run compile` = `tsc -p ./ && tsc -p tsconfig.webview.json && node build-webview.js`：webview 侧也做类型检查，但不进 `out/`。
- `scripts/check-webview-build.js` 在产物缺失或 <1 KiB 时退出 1，实测删掉 `media/board.js` 后退出码为 1；`npm run package` 里串联了它。
- 旧侧边栏 provider（`TodoWebviewProvider`）原样保留，命令与视图都未动。
