# 02: 五列来自 board 配置

**What to build:** tab 里出现 Jira board 真实的五列，名称与顺序与 Jira 上看到的一致，每列带计数（当前为 0）。列与状态的对应关系来自 board 配置，不是写死的。

**Blocked by:** 01

**Status:** resolved

- [x] 五列名称与顺序与 Jira 看板一致：To Do / In Progress / In Code Review / In Test / Done
- [x] 每列状态集合被正确解析，可在界面或日志中核对（To Do 含 Open，Done 含 Resolved 与 Pending Release，In Code Review 只有 In Review）
- [x] 空列显示为可见的空槽位，不是塌陷或消失
- [x] 取列失败（凭据错/超时）时显示可重试的错误态，而不是白屏
- [x] Jira 请求支持 https 实例（与现有 GitLab 客户端同构），boardId 来自配置而非写死

## Comments

- `JiraService` 整体重写：单一 `request(method, urlPath, body, timeout)`，按 `url.protocol` 选 `http`/`https`，https 走 `rejectUnauthorized:false` 的 agent；`port || 80` 的旧坑已消除。列表 10s、写入 20s。
- 列定义来自 `GET /rest/agile/1.0/board/{id}/configuration` 的 `columnConfig.columns`，`ranking.rankCustomFieldId` 一并取出（供 03 排序用）。`boardId` 读 `todoPanel.boardId`（默认 23）。
- 每次刷新都会打一行日志，便于核对状态集合：`[jira-board] board 23 列定义：To Do(1,10701) / …`。
- 失败语义：有历史数据时保留列并翻 `stale`；从未成功过则 `columns` 为空，界面进入带「重试」按钮的错误态。401/403 文案直接指到 `~/.scrumbuddy/config.json` 的字段。
- 空列渲染为虚线 `.col-empty` 槽位，列本身常驻。
