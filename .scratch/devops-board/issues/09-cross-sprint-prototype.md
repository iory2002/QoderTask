# 09 跨 sprint（含 Epic 分布）视图蓝图

Type: prototype
Status: closed
Blocked by: —

> **2026-11-10 判为超出目的地，关闭。**
> 理由：① B 想要的「第几轮」用一条 JQL（`fields=customfield_10004`，多值，条目数−1）就能拿到，不需要新视图；
> ② C 的 Epic × 阶段矩阵只有汇报时才用得上，且现有卡上的 Epic chip + 过滤已覆盖大半；
> ③ 两个方案都要多养一块面板，与「先把数据可信和个人交付流做对」的优先级冲突。
> 可回收的部分：`第几轮` / `自哪轮来` 作为 07 顶栏条目上的一个字段，不再需要独立视图。
> 产物保留：`prototype/cross-sprint.html`（三方案）、`research/probe-jira-sprints.js`、`research/probe-sprint-field.js`、`research/probe-sprint-cf10004.js`。

## Question

现有两板只看"当前活跃 sprint"。你要一张跨 sprint 的视图，回答"上一轮没做完的、这一轮在做的、下一轮已经排进来的"分别是什么，顺带看 Epic 维度的分布。

要产出一个**低保真蓝图**（不写实现，先看形状对不对）：

1. 布局：是按 sprint 分段（上一轮 / 本轮 / 下一轮），还是按"卡的状态"分段（遗留 / 进行 / 待启动）？
2. 每张卡显示什么：key、标题、阶段徽章（复用现有五级）、拖了几轮（"第 2 轮遗留"）。
3. Epic 维度：一个 Epic 下各卡的阶段分布（例如"5 张里 2 张已构建 1 张待审 2 张未提交"），是列表、堆叠条、还是折叠分组。
4. 数据来源与代价：跨 sprint 需要按 sprint 列表查（多次 JQL），慢；是"打开时拉一次 + 手动刷新"，还是复用事实库（依赖 03 的 schema）。
5. 边界：只覆盖项目白名单；Jira 里没有 sprint 的卡（Backlog）算不算；跨项目要不要混排。
6. 与现有两板的关系：第三个 tab？现有 Jira 板顶部切页签？还是侧边栏二级视图。

## 完成标准

一张可以被人指着说"这里改成那样"的蓝图（线框图/HTML 草图/ASCII 均可），落在 `research/09-cross-sprint-blueprint.md`，并在图旁列出"需要新增的数据查询"与"本蓝图明确不解决的问题"。
