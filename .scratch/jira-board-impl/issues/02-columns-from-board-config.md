# 02: 五列来自 board 配置

**What to build:** tab 里出现 Jira board 真实的五列，名称与顺序与 Jira 上看到的一致，每列带计数（当前为 0）。列与状态的对应关系来自 board 配置，不是写死的。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 五列名称与顺序与 Jira 看板一致：To Do / In Progress / In Code Review / In Test / Done
- [ ] 每列状态集合被正确解析，可在界面或日志中核对（To Do 含 Open，Done 含 Resolved 与 Pending Release，In Code Review 只有 In Review）
- [ ] 空列显示为可见的空槽位，不是塌陷或消失
- [ ] 取列失败（凭据错/超时）时显示可重试的错误态，而不是白屏
- [ ] Jira 请求支持 https 实例（与现有 GitLab 客户端同构），boardId 来自配置而非写死