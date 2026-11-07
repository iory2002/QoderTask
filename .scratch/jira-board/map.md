# Jira 泳道看板

Type: map
Status: decided

## Destination

一份可直接交给实现的 spec：QoderCN 工作区 tab 里的 Jira 泳道看板。

- **列**：取 Jira board 配置的 `columnConfig.columns`，不靠 transitions 反推。
- **行**：**不分行**。整个活跃 sprint 排成一条纵向滚动带；顶部提供项目多选过滤（选项从 sprint 内出现的 project key 自动生成）与「只看我的」开关。
- **卡片**：交付阶段徽章——`未提交` / `MR 待审` / `已 Approve 待合入` / `已合入待构建` / `已构建`，构建失败另挂红色 Build failed 标记。无 repo 条目的项目（MAGR3 / IB）不出徽章；有构建通道但无 job（`jenkinsJobPath: null`）顶格为「已合入」。事实来自 GitLab MR 与 Jenkins 构建。
- **写**：拖拽跨列 → 拉该 issue 的 transitions → 表单（默认填满当前值）→ 确认 → POST 回写 Jira。实测每次写都有必填项，**表单是主路径不是分支**。
- **推进**：拖拽合法性 = **该 issue 当前可用的 transitions 里存在 `to.statusId` ∈ 目标列**，与列是否相邻无关。Story 只能到 In Code Review，Bug/Task 直达 In Test，Task/Sub-task 还能一步到 Done。单向（回退去 Jira）；不做复合跳转；列永远常驻。
- **载体**：工作区 WebviewPanel（`createWebviewPanel`），活动栏图标作为入口；原侧边栏 TODO 面板与本地待办功能下线。

## Notes

**已锁定的前提**（是目的地的组成部分，不再逐条重开）：

- 关联规则：**MR 标题 → 描述 → `source_branch`**（实测分支名多为裸编号 `bug-891`，标题才是主信号）；key 正则必须带项目白名单（否则 `C1-6`/`L3-12` 会误报）；多个 MR 取阶段最高者。
- 请求：批量拉 + 30~60s 轮询；无变化不重绘；请求串行排队，上一轮没回来不发下一轮。
- GitLab 只读范围：MR 存在性、state、是否至少一个 approve。不做 MR 列表、不做评审操作。
- 构建判定：**只能时间窗**（实测拿不到 commit）。取目标分支 job 上「时间晚于 `merged_at` 的最近一次 SUCCESS」；进行中（`result=null`）不算失败；卡片必须显示构建的绝对时间，因为每天仅两次构建、单次跑 5∼20 小时。
- 已闭合的两条链路（GitLab `ultrasoundgeneralimaging/gipc-app` id=90878）：
  - NEX2 → target `nexus/dev/7.10.x` → Jenkins `…/gipc-app/nexus%2Fdev%2F7.10.x`
  - NEX → target `nexus/dev/5.10.x` → Jenkins `…/gipc-app/nexus%2Fdev%2F5.10.x`
  - **MAGR3 / IB 不接代码托管**（也无自动化构建）：不建 repo 条目，卡片不出阶段徽章 — **「有无 repo 条目」就是阶段追踪开关**，无条目不是配置缺失、不进告警。
  - 配置里的 `gitlab.defaultProjectId = 105706` **已失效（404）**。
- 配置：凭据仍读 `~/.scrumbuddy/config.json`（已支持 `enc:` 解密）；其余进 VS Code settings（`todoPanel.*`）。
- 状态推进：**无法用全局单链推导**。实测 workflow 按 issue type 分化（Story → `Review Code` → In Code Review；Bug → `Send to Test` → In Test；Task/Sub-task → `Resolve` → Done）；合法目标列必须逐 issue 拉 transitions 判定。**单向**，回退去 Jira 网页；**不做复合跳转**。
- 闸门是软的：未达标仍可拖入，但警告列出缺什么 + 二次确认。
- 手动手势只有「拖拽跨列」。同列排序、手动标记完成、本地卡片一律不做，所以卡片顺序必须由服务端事实推导——已实测为 `ORDER BY Rank ASC`（`customfield_10005`）。
- 范围：活跃 sprint ∩ **项目白名单**。白名单默认 `MAGR3 / NEX / NEX2 / IB`（实测 110/112 条：NEX2 87、MAGR3 11、NEX 8、IB 4；PQ 1 条与 ATD 1 条不在范围，VCP 0 条）。项目多选过滤的候选就是这 4 个；**「只看我的」默认打开**（默认视图 = 6 张，全在 NEX2）。**Epic 类型不作为卡片**（board filter 会把 Epic 带进来，必须剔除）。
- 用户在 Jira 里看到的「泳道」其实是 **按项目分组**（`NEX2` = 项目 key，`Nexus R2` = 项目名），不是 epic 泳道；插件里简化为不分行 + 项目过滤。
- Jira 在 commit/merge/build 期间**不动**；只有人主动拖拽或推送才会写。
- 旧本地待办（`.todo-data.json`）直接废弃，不做导出，README 注明为不可逆下线。

**环境约束**：

- QoderCN 1.25.1 = VS Code 1.106.3 分支 + Electron 42.2.0 + 约 Chromium 148，**标准 Chromium**。曾记录的「引擎有缺陷、`\s` 误匹配字母 s」已被推翻，真因是模板字符串吞反斜杠（见 research/01）。硬规则：**WebView 脚本走独立 .js + `asWebviewUri`，不要塞进模板字符串**。
- 「CSS 类会被 retainContextWhenHidden 缓存」高度可疑，更可能是 `out/` 未重编译或扩展未重装。内联样式不再是硬约束。

**实测事实（research/02）**：

- 列定义：5 列，含 statusId；但 22 个状态里有 7 个不在任何列（含 Blocked）。
- 一次可拉完整个 sprint：`maxResults=500` 被接受，112 条一次返回；`Rank = customfield_10005` 可直接排序。
- 预填的数据源是 issue 自身字段：transitions 元数据里的 `fields` 不携带当前值。
- 构建号只能来自 Jenkins：Jira 的 `Build` 字段实测全为空。

**协作偏好**：逐个提问，不批量抛问题。

**要读的东西**：`GLOSSARY.md`（Delivery Stage / Target branch / Board scope / Column / Advance Path / Unmapped status / Transition form）；技能 grilling、domain-modeling、prototype、research。

## Decisions so far

- [QoderCN WebView 引擎能力边界](issues/01-webview-engine-capability.md)：标准 Chromium（Electron 42.2.0）+ 无引擎缺陷；`\s` 问题是模板字符串吞反斜杠，已复现；脚本改走独立 .js。
- [Jira transitions 与必填字段的真实形状](issues/02-jira-transitions-metadata.md)：拿到 5 列定义、22 个状态、必填字段集；每次写都有必填；一次拉完可行。~~无 In Progress→In Test 直达~~ 已修正（见下）。
- [Jenkins job 映射与 SHA 可用性](issues/03-jenkins-job-mapping.md)：拿到 daily build job；**拿不到 commit，只能时间窗**；构建滞后半天到一天；job 必须显式配置。
- [看板布局原型](issues/04-board-layout-prototype.md)：以 `prototype/board.html` 为设计基线；卡宽 288 / 标题 3 行 / 窄屏横向滚动；列与阶段徽章并存；Epic chip 有则显示；Done 列灰化。
- [卡片信息架构与排序规则](issues/05-card-information-architecture.md)：字段与优先级已定；`Rank ASC` 排序；点卡片开详情浮层（阶段事实链 + 推送按钮）。
- [必填字段表单的范围与预填规则](issues/06-transition-form-scope.md)：string/option/array/user 四类控件，其余硬阻断并跳 Jira；预填用 issue 字段快照；**从不写评论**。
- [失败与降级语义](issues/07-failure-and-degradation.md)：新增第六态「无法判定」+ 顶栏横幅；写入乐观 + 待提交标记 + 失败弹回；写入期间冻结卡片。
- [推进点重定义](issues/09-advance-path-redefinition.md)：**workflow 按 issue type 分化**（Story 走 In Code Review，Bug/Task 直达），拖拽合法性由逐 issue 的 transitions 决定；单向；不做复合跳转；列常驻。
- [卡片归属：列外状态与 Sub-task](issues/10-card-placement-rules.md)：Sub-task 保留（独立 workflow，阶段从父任务继承）；列外状态不渲染但顶栏报数。
- [前端技术形态选型](issues/11-frontend-stack-choice.md)：Preact + esbuild，脚本走独立 `.js` + `asWebviewUri`；组件拆分与打包失败面已定。
- [分阶段落地与验收](issues/08-phased-delivery.md)：三期——v0.3 只读看板 / v0.4 写回 / v0.5 构建阶段；每期验收判据与不做清单已定。

> **地图已走完**，产物：[`spec.md`](spec.md)
> 实现票（由 `/to-tickets` 拆分）住在另一个目录：[`.scratch/jira-board-impl/issues/`](../jira-board-impl/issues/)，避免与本目录的决策票编号冲角。

## Not yet specified

- 首次打开看板的加载态（骨架屏 / 进度提示）与空态（sprint 里没有 issue 时说什么）
- 现有 `todoPanel.refresh` / `todoPanel.syncGitLab` 命令的去向（重定义还是删除）
- 快捷键与命令面板的入口命名

## Out of scope

- GitLab 完整能力（MR 列表、approve 操作、discussion、todo 同步）——第二主线，本期只留最小只读通道
- 插件内编辑 Jira 其他字段（assignee / worklog / 描述 / 评论管理）
- 手动标记完成、同列排序、本地卡片、泳道折叠
- 用 Qoder Canvas 制品（`.canvas.tsx`）做看板
