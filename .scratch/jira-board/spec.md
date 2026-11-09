# Jira 看板 Spec

状态：可交实现 · 来源：`.scratch/jira-board/`（地图 + 11 张决策票 + 5 份实测研究）
实现票：[`.scratch/jira-board-impl/issues/`](../jira-board-impl/issues/)（00∼11，按依赖排序）
术语：见仓库根 `GLOSSARY.md`。所有"实测"字样均指 2026-11-07 对该内网环境的只读探测（`research/probe-*.js` 可重跑）。

---

## 1. 一句话目标

把现在侧边栏里那份待办列表，换成**工作区 tab 里的 Jira 看板**：五列是 Jira 状态，卡片上挂 GitLab/Jenkins 的交付事实，拖一下就能把状态推进一步。

---

## 2. 范围

**做**

- 工作区 `WebviewPanel`（编辑器中的一个 tab），活动栏图标作为入口
- 五列取自 Jira board 配置；不分行；项目过滤 + 「只看我的」（默认开，默认范围只有 NEX2）
- 交付阶段徽章：`未提交` / `MR 待审` / `已 Approve 待合入` / `已合入待构建` / `已构建` / `无法判定`
- **阶段追踪只覆盖 NEX2 与 NEX**；MAGR3 / IB 只做 Jira（无阶段徽章，也无自动化构建）
- 详情浮层：阶段事实链（MR、approve、构建号与时间）+「打开 GitLab MR」+「在 Jira 中打开」

> **2026-11-07 调整：放弃写回，看板只读。** Jira 的 transition 绝大多数带必填字段（screen），插件里无法可靠填写，拖拽会变成「拖下去→卡在表单」。因此没有拖拽、没有表单、没有软闸门，改状态一律去 Jira。

**不做**

- **写回 Jira**（原 v0.4 整体取消）：无拖拽、无 transition 表单、无软闸门。原因：transition 屏幕的必填字段无法在看板里可靠完成。
- 同列内排序、手动标记完成、本地卡片、泳道/行分组
- 拖拽回退（`Return` / `Revert` / `Fail`）——回退去 Jira 网页
- 写 Jira 评论、改 assignee / worklog / 描述
- MR 列表、approve 操作、discussion
- Qoder Canvas 制品形态

---

## 3. 架构

进程边界不变：扩展进程负责所有 HTTP 与凭据，WebView 只负责渲染与交互。

```
extension.ts
  ├─ BoardPanel            createWebviewPanel + 生命周期
  ├─ JiraService           列定义 / 搜索 / transitions / 写入     (改)
  ├─ GitLabService         MR 最小只读通道                        (改)
  ├─ JenkinsService        job 构建时间窗                          (新)
  ├─ DeliveryStageResolver 事实 → 阶段（纯函数，可单测）            (新)
  └─ BoardState            内存态 + 轮询调度

media/board.js             Preact 产物（esbuild 打包，asWebviewUri 加载）
```

**构建**：`npm run compile` = `tsc -p ./ && node build-webview.js`。`npm run package` 前必须校验 `media/board.js` 存在且非空，否则拒绝打包（避免发出空看板）。

**脚本不得内联进模板字符串**——曾因模板字符串吞掉反斜杠导致 `/\s+/g` 变成 `/s+/g`，把 `In Progress` 变成 `in progre-`。

---

## 4. 消息协议

WebView ⇄ 扩展，`postMessage`，统一 `{ type, requestId?, payload? }`。

| 方向 | type | 载荷 |
|---|---|---|
| →扩展 | `board:refresh` | `{ force?: boolean }` |
| →扩展 | `board:setScope` | `{ projects: string[], onlyMine: boolean }` |
| →扩展 | `card:openDetail` | `{ key }` |
| →扩展 | `card:fetchTransitions` | `{ key }` |
| →扩展 | `card:transition` | `{ key, transitionId, fields }` |
| ←WebView | `board:state` | `{ columns, cards, scope, freshness, notices }` |
| ←WebView | `card:transitions` | `{ key, transitions[] }` |
| ←WebView | `card:transitionResult` | `{ key, ok, error? }` |
| ←WebView | `board:notices` | 未映射状态数、缺失配置 |

---

## 5. 配置

凭据仍读 `~/.scrumbuddy/config.json`（已有 `enc:` AES-GCM 解密），**不迁移、不复制**。
其余进 VS Code settings：

```jsonc
"todoPanel.projects": ["NEX2"],
"todoPanel.onlyMineByDefault": true,
"todoPanel.pollIntervalSec": 45,
"todoPanel.repos": [
  {
    "jiraProjects": ["NEX2"],
    "gitlabProject": "ultrasoundgeneralimaging/gipc-app",   // id=90878
    "targetBranch": "nexus/dev/7.10.x",
    "jenkinsJobPath": "UltrasoundGeneralImaging/ultrasoundgeneralimaging%2Fgipc-app/nexus%2Fdev%2F7.10.x"
  },
  {
    "jiraProjects": ["NEX"],
    "gitlabProject": "ultrasoundgeneralimaging/gipc-app",
    "targetBranch": "nexus/dev/5.10.x",
    "jenkinsJobPath": "UltrasoundGeneralImaging/ultrasoundgeneralimaging%2Fgipc-app/nexus%2Fdev%2F5.10.x"
  }
]
```

`jenkinsJobPath` 用 `/` 分段、每段已含编码后的 job 名（分支名里的 `/` 写作 `%2F`），实现时逐段 `encodeURIComponent`。

**当前默认范围只开 NEX2**。NEX、MAGR3、IB 的映射与结论仍保留在文档里，但不是默认范围：

- 白名单外的项目不仅不出卡，**其 repo 条目也不发请求**（避免无意义的 GitLab/Jenkins 调用）。
- 把项目加回 `todoPanel.projects` 即重新生效；NEX 的映射已经验证过（`nexus/dev/5.10.x`），MAGR3 / IB 则没有自动化构建，加回后只能到「已合入」。

因此「有无 repo 条目」就是追踪开关：

| 配置 | 卡片表现 | 是否告警 |
|---|---|---|
| 有条目 + `jenkinsJobPath`（NEX2 / NEX） | 完整五级阶段 | 仅取数失败时 |
| 有条目 + `jenkinsJobPath: null` | 顶格「已合入（无自动构建）」 | 否 |
| **无条目**（MAGR3 / IB） | **不出阶段徽章** | 否 |
| 有条目但 GitLab/Jenkins 报错 | 「无法判定」 | 是 |

> `gitlab.defaultProjectId = 105706` 已失效（404）。实现不得依赖它，统一用 `todoPanel.repos[].gitlabProject` 的路径或仓库 id。

---

## 6. Jira 集成契约（实测）

### 6.1 列定义

`GET /rest/agile/1.0/board/{id}/configuration` → `columnConfig.columns[]`。本 board（23）实测：

| 列 | statusId |
|---|---|
| To Do | 1 (Open), 10701 (Waiting for Feedback) |
| In Progress | 3 (In Progress), 10700 (Investigating) |
| In Code Review | 10101 (In Review) |
| In Test | 10401 |
| Done | 10500, 10600 (Pending Release), 10601 (Released), 10302 (Cancelled), 5 (Resolved) |

**卡片归属用 statusId 匹配，不能用状态名。** 另取 `ranking.rankCustomFieldId`（=10005）用于排序。

### 6.2 取卡片

一次请求拉完，不分页：

```
GET /rest/api/2/search
  jql = sprint = <activeSprintId>
        AND project IN (<项目白名单>)
        AND issuetype != Epic
        [OR key IN (<extraIssueKeys>)]   // 仅 devMode 打开时
  fields = summary,status,issuetype,priority,updated,assignee,customfield_10000,customfield_10005,parent,comment
  maxResults = 500           // 实测被接受，112 条一次返回
  // 排序：ORDER BY Rank ASC
```

- **「只看我的」不进 JQL**：全量拉一次，服务端把 `isMine`（`assignee.name === /myself` 的 `key/name`）算好随卡片下发；切开关只在前端过滤，**不重发请求**。刷新按钮才是全量重取。
- **必须包含 Done 状态**（旧实现 `status not in (..., Done)` 会让 Done 列永远为空）。
- 不排除 Sub-task（见 §7.3），只排除 Epic。
- `fields.status.statusCategory` 可作兜底信息，不作为分列依据。

### 6.3 推进

```
GET  /rest/api/2/issue/{key}/transitions?expand=transitions.fields
POST /rest/api/2/issue/{key}/transitions
     { "transition": { "id": "<id>" }, "fields": { /* 仅改动项 */ } }
```

- **可拖拽目标 = transitions 中存在 `to.statusId ∈ 目标列`**，与列相邻与否无关（见 §7.1）。
- 每次拖拽都重新拉 transitions，**不缓存超过一次交互**。
- 400 响应的 `errors` 是字段级结构，直接回填到对应控件。
- 不写评论（`update.comment` 一律不用）。

### 6.4 已知坑

- `JiraService` 现用 `http` 模块且 `port || 80`，只支持 http 实例。**改造为与 `GitLabService` 同构的双协议实现**（含 `rejectUnauthorized: false`）。
- 超时：列表 10s，写 20s（拉 transitions + POST 两跳）。

---

## 7. 交付阶段

### 7.1 workflow 按 issue type 分化（最容易被做错的一条）

同样的 `In Progress`，不同类型出口完全不同：

| Type | 可用出口 |
|---|---|
| Story | `Review Code` → In Code Review；`Return` → Open |
| Bug | `Send to Test` → In Test；`Revert` → Open |
| Task | `Resolve` → Resolved（Done）；`Send to Test` → In Test；`Revert`；`Cancel` |
| In-Sprint Bug | `Send to Test` → In Test |
| Sub-task | `Resolve` → Resolved（Done）；`Revert`；`Cancel` |

→ **任何"先推到相邻列"的硬编码都是错的。** 合法性只能逐 issue 判定。

### 7.2 阶段判定

按优先级取最高已达成者：

1. **已构建** — 目标分支 job 上存在 `timestamp > merged_at` 且 `result == SUCCESS` 的构建
2. **已合入待构建** — 关联 MR `state == merged` 且目标分支命中，但无更晚的成功构建
3. **已 Approve 待合入** — MR `state == opened` 且 `/approvals` 的 `approved === true`
4. **MR 待审** — MR `state == opened`，无 approve
5. **未提交** — 该 key 无关联 MR（且数据源齐备）
6. **无法判定** — 有条目但取数失败/超时，**不得降级成"未提交"**

不在追踪范围的项目（无 repo 条目，如 MAGR3 / IB）**不计算阶段、不出徽章**，也不显示「无法判定」。

**无构建通道的项目**（`jenkinsJobPath: null`）：阶梯只到第 2 级，文案直接用「**已合入**」，不出现「待构建」字样，也不出 Build failed。否则卡片会永久挂在等构建上，等于误报。

**构建校验按 issue 类型分化**：只有 `Story` 与 `Bug` 看构建（实测只有它们走代码交付链）；`Task`、`Sub-task` 不查 Jenkins，阶段同样顶格在「已合入」。两个理由：

1. Task / Sub-task 是配置、测试用例、文档类工作，本来就不会触发构建，盯着构建会让它们永远停在「待构建」。
2. Jenkins 取数失败只应影响需要构建的类型；一个 Task 不应因为 Jenkins 挂了而变成「无法判定」。

实现要点：类型名单可配置（`todoPanel.buildCheckIssueTypes`，默认 `Story`/`Bug`，大小写不敏感精确匹配）；仓库内没有任何需要构建校验的卡时，**连 Jenkins 请求都不发**。

构建失败：阶段停在 `已合入待构建` 并挂红色 `Build failed`；构建进行中（`result == null`）视为没有结果，既不成功也不失败。

### 7.3 Sub-task

- 保留为卡片，标「子」角标。
- 自己的 key 极少出现在分支名里，所以**阶段继承父任务的阶段**；父任务无阶段则显「无法判定」。

---

## 8. GitLab 最小只读通道

- **关联顺序：MR 标题 → MR 描述 → `source_branch`**。实测分支名多为裸编号（`bug-891` / `task-932`），不带项目前缀；标题几乎总含完整 key。
- **key 正则必须带项目白名单**：`/\b(NEX2|MAGR3|NEX|IB)-\d+\b/g`（长 key 在前）。用通用 `[A-Z]+-\d+` 会把 `C1-6`、`L3-12`、`ML6-15` 误当 key。
- **前缀继承**：标题如 `NEX2-1038+1039` 时，`+1039` 要继承 `NEX2` 前缀，否则 NEX2-1039 会被误判成「未提交」（实测 !3749）。
- 一个 key 命中多个 MR 是常态（实测 NEX2-932 有三个：!3720 / !3760 / !3769）。卡片取**阶段最高者**；同阶段取 `merged_at` 最新者（!3769）；详情浮层列出全部。
- **审批只能看 `/approvals`，不能看列表**：`approved_by` 在列表与详情接口**根本不存在**（不是空数组）；已合并 MR 在 `/approvals` 里依然有完整审批记录。
- **判据是 `approved === true`（等价 `approvals_left === 0`），不是 `approved_by.length > 0`**。实测 `!3636` 有 1 个 approver 但 `approved=false`、`approvals_left=1`。
- **请求形状**：每轮 1 次列表请求 + 仅对 `state=opened` 的 MR 补一次 `/approvals`（个位数，有并发上限）；`merged` 不查审批。这不是「按卡片逐个查」——卡片 110 张，opened MR 只有几个，且一个 MR 可服务多张卡。
- **禁止用 `detailed_merge_status` 当审批判据**：merged 的 MR 统一为 `not_open`；opened 的值是复合语义（`not_approved` / `draft_status` / `requested_changes`），非 `not_approved` 不等于已批准（CI 未完成也会出现非 `not_approved`）。旧 `GitLabService` 就是在这里踩过坑。
- 标题/描述/分支都无 key 的 MR（如 !3753）不归属任何 issue，忽略即可。
- 每轮只发一次列表请求（`target_branch` + `updated_after` 收窄），本地 join，**绝不按卡片逐个查**。
- 列表所需字段：`iid`、`state`、`target_branch`、`source_branch`、`title`、`description`、`merged_at`、`merge_commit_sha`、`web_url`、`updated_at`。`/approvals` 额外提供：`approved`、`approvals_required`、`approvals_left`、`approved_by[]`。
- 项目范围来自 `todoPanel.repos[].gitlabProject`；未配置 → 该项目的卡片全部「无法判定」。

---

## 9. Jenkins 通道

- 寻址：`{baseUrl}/job/{org}/job/{repoJob}/job/{branchJob}/api/json?tree=builds[number,result,timestamp]`
- **拿不到 commit**（实测 `lastBuiltRevision` 无 rev、`changeSet` 为空、`GITLAB_COMMIT_ID` 恒空）→ 只能时间窗。
- 构建节奏：每天两次启动（04:07 / 14:00 附近），单次 5～20 小时。**「已构建」天然滞后半天到一天**，所以：
  - 卡片与详情浮层必须显示构建的**绝对时间**与分支；
  - 推进 In Test 的闸门挂在「已合入」，不挂在构建上。
- 自签证书：`rejectUnauthorized: false`。

---

## 10. 交互规格

**只读。** 看板不提供任何写 Jira 的入口。

| 场景 | 行为 |
|---|---|
| 点卡片 | 打开右侧详情浮层（阶段事实链） |
| 点卡片上的 key | 浏览器打开 Jira issue |
| 详情浮层「打开 GitLab MR」 | 浏览器打开卡片上展示的那个 MR |
| 详情浮层「在 Jira 中打开」 | 浏览器打开 issue 页，改状态在那里做 |
| 数据源缺失 | 阶段显「无法判定」+ 顶栏可折叠横幅（GitLab 未配置 / 某项目 job 未填） |
| 401/403 | 提示指到具体文件与字段（`~/.scrumbuddy/config.json` 的 `jira.password` / `gitlab.token` / `jenkins.token`） |
| 超时 | 保留上次成功数据，标「数据可能过期 · hh:mm」 |
| 首次加载 | 五列骨架屏 + 「正在加载看板…」，不渲染空列也不弹告警 |

轮询：30～60s；请求串行排队（上一轮未返回不发下一轮）；**数据无变化则不重绘**。

> 已删除的写回通道：`card:fetchTransitions` / `card:transition` / `card:transitions` / `card:transitionResult`，以及 `dropRules` / `transitionForm` / `softGate` 三个纯函数模块及其 21 条单测。

---

## 11. UI 规格

基线：`.scratch/jira-board/prototype/board.html`（可直接打开对照）。

- **顶栏**（从左到右）：产品名 + **sprint 名（亮色 `#FAFBFD` 突出）** → 项目范围**只读标签**（取自 `todoPanel.projects`，不可点）→ 「只看我的」（纯视图开关）→ 列外状态计数 → 同步时间 + 张数 → 刷新。
  > 2026-11-07 调整：移除「全部」按钮与项目 chip（范围只能改设置）；**DEV 开关从顶栏移回设置**（`todoPanel.devMode`），顶栏不再显示。
- **列**：五列常驻不隐藏；列头显示名称与计数；空列保持虚线框。窄于 900px 时横向滚动，不上下堆叠。
- **卡片**（宽 288px，标题截 3 行）：
  ```
  [类型图标] KEY                        [头像*]
  [优先级] 三行标题……
           [Epic chip]              [💬 n]
           [阶段徽章] [Build failed]
  ```
  `*` 头像只在「只看我的」关闭时显示。
- **阶段徽章配色**：未提交 `#f1f3f5/#6b7280`；MR 待审 `#3A5A7F/#fff`；已 Approve `#7C3AED/#fff`；已合入待构建 `#F59E0B/#3d2800`；已构建 `#10B981/#fff`；Build failed `#EF4444/#fff`；无法判定 灰底虚线框 `#b42318` 文字。
- **Done 列**：全量展示但整体灰化。
- **详情浮层**：阶段事实链（MR 链接 / approver / merged_at / build 号 / 构建时间 / 分支）+ 推导说明 + 「打开 GitLab MR !n」+「在 Jira 中打开」。
  > 实现备注：「推送 In Test」按钮已取消。地图里定的手动手势只有「拖拽跨列」，浮层里的按钮会变成第二条写入路径，与 `card:transition` 的单卡单次通道重复。
  > 实现备注：MR 已创建时，浮层底部必须有显式的「打开 GitLab MR」按钮（指向卡片上展示的那个 MR）；多 MR 时按钮注明「另有 N 个」，其余 MR 在列表里逐个可点。只给「在 Jira 中打开」不够——用户看交付事实时下一步往往就是去 MR 上看 diff/评论。

---

## 12. 数据模型

```ts
type Stage = 'none' | 'mr' | 'approved' | 'merged' | 'built' | 'unknown';

interface BoardCard {
  key: string; summary: string; issueType: string; priority: string | null;
  statusId: string; columnName: string;
  epicKey: string | null; epicLabel: string | null;
  rank: string;                       // customfield_10005，字典序即顺序
  isSubtask: boolean; parentKey?: string;
  stage: Stage; buildFailed: boolean;
  mr?: { iid: number; state: string; url: string; approvedBy: string[]; mergedAt?: string };
  build?: { number: number; result: string | null; timestamp: string; branch: string; url: string };
  transitions: { id: string; name: string; toStatusId: string }[];  // 展开时按需加载
}
```

`DeliveryStageResolver` 是**纯函数**：输入卡片 JSON + MR 列表 + 构建列表，输出 `Stage`。这层要能脱离 WebView 单测。

---

## 13. 分期与验收

**v0.3 只读看板 + 阶段徽章** — 五列 + 项目过滤 + 只看我的 + 卡片 + MR 阶段 + 详情浮层（只读）；不写 Jira。
验收：能看到自己的 6 张卡；Done 列非空；GitLab 未配置时显示「无法判定」而非「未提交」。

**~~v0.4 写回~~** — 已取消（2026-11-07）。transition 必填字段无法在看板里可靠完成。

**v0.5 构建阶段** — 时间窗判定 + `已合入待构建/已构建/Build failed` + 详情补构建事实。
验收：有更晚的 SUCCESS 时显「已构建」并给出时间；进行中不误判为失败；job 未配置显「无法判定」。

回滚：每期独立 vsix；写能力只允许单卡单次，无批量操作。

---

## 14. 风险与未决

| 项 | 说明 |
|---|---|
| MAGR3 / IB 的 GitLab 侧 | **不接**（也无自动化构建）：不建 repo 条目，卡片不出阶段徽章 |
| 多人合写标题 | `NEX2-1038+1039` 这类简写靠前缀继承处理；若出现 `NEX2-1038 / NEX-2591` 混写，只能关联到第一个 |
| approve 粒度 | 只回答「是否已批准」（`approved` 布尔值），不区分谁批的、是否过期；详情浮层可展示 `approved_by` 名单供参考 |
| 时间窗误判 | 若别人的合入恰好插在你的 `merged_at` 与下一次构建之间，可能显示成你的构建成功；详情浮层必须给出构建时间与分支供人判断 |
| MAGR3 / IB 无阶段信息 | 这两个项目只看 Jira，卡片没有阶段徽章；用户只能靠 Jira 状态自己判断交付进展 |
| In Code Review 长期为空 | 只有 Story 会经过，且本 sprint 为 0；空列是预期形态 |
| 首屏加载态 | 未定：骨架屏 vs 进度条（不阻塞实现，建议骨架屏） |
| 旧命令 | `todoPanel.refresh` / `todoPanel.syncGitLab` 的去向未定（建议重定义为「刷新看板」并删除 GitLab 同步） |

---

## 15. 附录：关键实测数据

- 活跃 sprint 521 `Sprint (11.18)`，112 条；项目分布 NEX2 87 / MAGR3 11 / NEX 8 / IB 4 / PQ 1 / ATD 1。
- `sprint = 521 AND assignee = currentUser()` = **6 条**（全部 NEX2），与用户在 Jira 上看到的「6 issues」逐一对上。
- 全部状态 22 个，其中 7 个不在任何 board 列：Closed / Done / Reopened / Blocked / Updating / Backlog / TODO。
- 每次 transition 都有必填项；NEX2 的 `Start` 有 8 个（issuetype, summary, customfield_11900, versions, customfield_12100, customfield_12202, customfield_12200, customfield_12201），PQ 的同名 transition 只有 1 个。
- Jenkins daily build：`nexus/dev/7.10.x`，#243 耗时 864 分钟；最近 8 次构建 `GITLAB_COMMIT_ID` 全为空。
- GitLab `ultrasoundgeneralimaging/gipc-app` id=90878；`nexus/dev/7.10.x` 与 `nexus/dev/5.10.x` 均存在且持续更新（7.10.x HEAD 2026-11-07 06:43）。
- Jenkins `nexus/dev/5.10.x`：`#443 SUCCESS 2026-11-06 04:07`（1176 min）、`#442 SUCCESS 2026-11-02`（688 min）。
