# 07: 事实库 A：适配器、DDL 与写入

**What to build:** 扩展在本地建立一个事实库；每次成功取数后先把事实写进库，再渲染。Jira 与 GitLab 按 scope 全量替换（单一事务），构建历史累积写入。写库失败不影响界面，只记日志并沿用内存态。

**Blocked by:** 01, 02, 05（库要存 `has_conflicts`、`build.sha`、`merge_commit_sha`，这三项由那三张票引入；时间必须已是 epoch 才能进整数列）

**Status:** resolved

- [x] 零依赖使用宿主内建的 sqlite；启动时做能力探测，探测失败只记日志（降级行为由 09 完整实现）
- [x] 表结构与决策记录一致：`meta` / `board` / `sprint` / `issue` / `mr` / `mr_approval` / `build`
- [x] `user_version` 初始化为 1
- [x] 每次成功取数后：库中该 scope 的数据等于这次快照，无残留脏行
- [x] 构建历史按 job 累积，超过 200 条时删除最旧的
- [x] 事实与"上次成功时间"在同一事务内提交（失败时不得把旧数据标成新鲜）
- [x] 派生状态（阶段、角标、推导依据）不落库
- [x] 单测：全量替换后行数正确、时间以 epoch 存储、写库异常不抛出到界面

## Comments

- `src/board/FactStore.ts` + `src/board/schema.ts`：`loadSqlite()` 能力探测，`open()` 失败返回 null；所有写方法返回 boolean，异常只记日志。
- `fetch_state` 表的 DDL 已建（属于 02/10），本票只写 `last_success_at`，抢占逻辑留给 10。
- **写入分工**：`gitlab:<project>@<branch>` 只由 Jira 板写——它拉的是目标分支全量；MR 板拉的是按人过滤的切片，写同一 scope 会互相覆盖。MR 板在 08 读库、缺数据时退回内存态。
- 审批按 MR 快照替换（delete + insert），`approved_at` 从 `/approvals` 的 `approved_by[].approved_at` 解析成 epoch；接口没给就存 NULL。
- 测试：`test/fact-store.test.ts`（全量替换、epoch、200 条保留、回滚、关闭后不抛）。提交 `8bb3bac`。

