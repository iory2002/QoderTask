# 地图：两板（Jira Board / GitLab Board）的 DevOps 改进

## Destination

一份按价值排序、可直接切票执行的 DevOps 改进 backlog（spec）：把两板从「各自轮询的内存快照」推到「共享事实库 + 可证明的交付事实 + 一眼看出该我动什么」。范围：只读工具、每人各自设备、**多开窗口共用一个本地事实库**。

## Notes

- **只读**：不改 Jira / GitLab，不自动评论、不触发构建、不合入。所有"要动手"的出口统一成**一键复制 / 深链**（沿用 `MrReviewHandoff` 的形态）。
- **事实优先于推断**：结论要么有服务端字段/时间戳支撑，要么在界面上明示「推断」。绝不用「未知」冒充「没有」。
- **多开窗口**：一个机器上可能同时开好几个 IDE。事实库共享，刷新由**活跃实例**持有租约执行，其余实例只读、不重复抓取。
- **研究产物**：落 `.scratch/devops-board/research/`（本仓库没有远端研究分支流程，探针脚本随代码留在仓库里）。
- **既有结论已被推翻**：`.scratch/jira-board/research/03-jenkins-mapping.md` 的「拿不到 commit，只能走时间窗」是错的——证据见 `research/probe-jenkins-attribution.js`，构建的 commit 在 `BuildData.lastBuiltRevision.SHA1` 里，GitLab 侧还有 `commit statuses` / `pipelines?sha=` 可反查。
- **优先级**：数据可信 > 个人交付流 > 跨 sprint / Epic 蓝图 > 指标。
- **会话技能**：`grilling` + `domain-modeling`；开工前先读 `GLOSSARY.md`，新术语当场写回去。
- **Sprint 字段已探明**：`customfield_10004`，**多值**（界面上是 `Sprint ZuiHuaYin(10.21), Sprint (11.4), Sprint (11.18)`）。所以「第几轮」≈ 条目数 − 1，一条 JQL 就够，不需要逐轮拉 issue 列表、也不需要 changelog。待确认：REST 里是字符串还是数组（`research/probe-sprint-cf10004.js`，曾撞上 Jira 403）。
- **board 23 的现状**：活跃 sprint 为 `#521 Sprint (11.18)`；列 = To Do / In Progress / In Code Review / In Test / Done。

## Decisions so far

- [06 构建阶段升级：把「已构建」从推断变成可证明](issues/06-build-attribution-upgrade.md)：`已构建` = **最新一次成功构建**的代码树包含该合入（用 `merge_base` 判祖先，不用时间窗）；FAILURE / 进行中都不算；不设「构建中」级别；GitLab commit statuses 不作判据；卡面不写构建号，详情写“#250 包含本次合入”，并明示“代码进去了、不等于产物里有”。
- [08 出口与提醒](issues/08-copy-exits-and-alerts.md)：评审要点单只写可证明的事实（文件数/目录/敏感路径/关联卡/批准人，成本为零）；冲突上 MR 卡面，未解决讨论与“合入后 3 天未推进”只进详情；构建失败只标“高风险”情形（从未成功过且最新已完成构建 FAILURE），不断定因果；不做催审文案、不做 toast、不做构建失败复制。
- [01 存储引擎](issues/01-storage-engine-research.md)：用宿主内建的 `node:sqlite`（Electron 42.11.18 内嵌 Node 24.19.0，无需 flag，零依赖）；db 放 `globalStorageUri` 供多窗口共享；WAL + `busy_timeout=300`；同步 API 会阻塞宿主，事务要小、查询要有界。
- [02 多实例协调](issues/02-multi-instance-coordination.md)：不做 leader/租约，改用“新鲜度时间戳 + 短期占位”（一个原子 UPDATE + `changes()` 定胜负）；TTL 50s / 占位 45s / 退避 15s；跟随者每 3s 读 `PRAGMA data_version`；库不可写就退回单窗口直连。
- [03 事实库 schema](issues/03-fact-schema-retention.md)：只存事实（meta/board/sprint/issue/mr/mr_approval/build）不存派生；Jira/GitLab 按 scope 全量替换，build 用 UPSERT；mr 与审批永久、issue 只留当前 sprint；指标起点 `meta.first_seen_at`；迁移前 `.bak`，高版本库只读不降级。
- [04 GitLab 时间戳](issues/04-gitlab-timestamps-research.md)：`/approvals` 自带 `approved_at` 且合并后仍保留；前置时间、评审等待、构建成功率、每日合入数都可做，评审往返次数不可做；时间必须 `Date.parse()` 成 epoch（+08:00 偏移）；**取数窗口只剩 20 条余量（90 天 280 条 / 3 页上限 300），实现时要改成翻到空页**。

<!-- 每关闭一张票，在这里加一行：只有指针，不重复答案 -->

## Not yet specified

- **跨设备 / 团队共享**：多人各自设备时"谁的口径算准"——得先让单机多实例跑稳，再谈聚合。
- **通知渠道**：除本地 toast 之外，是否要 IM / 邮件（涉及写外部系统，需另开地图）。
- **发布视图**：`7.10.x` 这条线当前在哪个环境、有哪些"已合入未构建"。

## Out of scope

- **写操作**：催审、自动评论、触发构建、打 tag、改 Jira 状态、合并 MR（Q3 明确：VSIX 工具的最后一公里，严格只读）。
- **统一配置 / 共享后端 / 多租户治理**：推广刚开始，等真实使用结果再单独开图。
- **Jenkins 侧改造**：让 job 输出 changelog、注入 `GITLAB_COMMIT_ID`——不在本工具射程内。
- **「某次构建包含哪些卡」的近似反向视图**：按时间区间圈卡的误读风险高于收益（Q6 选 b 不选 c）。
- **代码评审本身**：发生在 Qoder 会话里，本工具只负责把材料递到手上。
- **跨 sprint / Epic 视图**（[09](issues/09-cross-sprint-prototype.md)）：先不做。B 的「第几轮」一条 JQL 就能算，不需要新界面；C 的 Epic 矩阵只有汇报才用得上，现有 Epic chip + 过滤已覆盖大半；两者都要多养一块面板。原型与探针保留在仓库里，若将来要，只需把「第几轮」作为详情浮层上的一行，不重开视图。
- **顶栏「该我动」（[07](issues/07-topbar-information-architecture.md)）**：无独立价值。聚合数字只是把列里已经看得见的东西数一遍；“待我审”已有整列 + 角标两个位置，顶栏 chip 是第三次重复。真正缺的两个事实（MR 冲突/未解决讨论、合入后未推进）已并入 08 且落在卡与详情上。
- **趋势指标（[05](issues/05-metrics-minimal-set.md)）**：用户决定丢弃。评审等待/构建成功率“看了也改变不了今天的动作”，且要新增图表面板。04 的研究结论（`approved_at` 可拿、时间戳按 epoch、窗口余量）仍已归档，将来要做直接接上。
