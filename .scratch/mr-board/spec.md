# GitLab MR Board — Spec

Status: ready-for-agent
Feature: `mr-board`
Date: 2026-11-07

## Problem Statement

我每天要回答两个问题，现在都得离开编辑器：

1. **有没有 MR 在等我审？** 只能在 GitLab 网页的 `Merge requests` 列表里翻，或者靠邮件/IM 提醒。漏掉一个就是别人被卡住。
2. **我提的 MR 现在卡在哪？** Jira 看板上虽然有 `MR 待审 / 已 Approve 待合入` 徽章，但那是 **issue 视角**：一个 issue 可能挂三个 MR，一个 MR 也可能覆盖两个 issue，而且它永远回答不了"这个 MR 是谁在等我、谁已经批了"。

更麻烦的是第三步：**看到 MR 之后要真的去审**，得切到聊天面板、新建会话、复制链接、重新描述背景——上下文每次从零开始。看板和评审之间断了一截。

## Solution

在 `PC Board` 里加第二块看板 `GitLab Board`，和 `Jira Board` 并列：

- **两列**：`Reviewer 包含我`（待我审）与 `我提交的`（author = me）。不设"未合入"列——所有显示中的 MR 都是未合入的，合入即退场。
- 只收目标分支上 `opened` 的 MR；已合入（`merged`）不显示，被关闭（`closed`）不占列、只在顶栏计数。
- 状态用文字徽章表达（`待我审` / `未审` / `已审（N 人）`），和 Jira 卡片的阶段徽章同一套视觉语言。
- **右键「待我审」的卡片**：扩展先替我把这个 MR 的 diff 落到工作区，再把一条 `/code-review` 指令写进剪贴板；我新建一个 Qoder 会话、粘贴、回车，评审就从看板一步进入 IDE。

## User Stories

### 入口与范围

1. 作为使用者，我想从活动栏 `PC Board` 的入口页看到「打开 Jira 看板」和「打开 GitLab 看板」两个入口，以便不用记命令也能进任意一块看板。
2. 作为使用者，我想点活动栏图标时默认打开 `Jira Board`，以便保持现在的使用习惯不被改变。
3. 作为使用者，我想让 `GitLab Board` 作为独立的编辑器 tab 打开，以便两块看板可以并排或各自保留滚动位置。
4. 作为使用者，我想在设置里配置一组 `Repo + Branch`（默认只有 `ultrasoundgeneralimaging/gipc-app @ nexus/dev/7.10.x`），以便按需要加入 5.10.x 或其他仓库，而不用改代码。
5. 作为使用者，我想让 `GitLab Board` 的取数范围与 Jira 看板的 `todoPanel.repos` 相互独立，以便加一条 5.10.x 的 MR 范围时不会顺带改变 Jira 看板的阶段判定。
6. 作为使用者，我想在顶栏看到当前生效的仓库/分支 chip，以便一眼确认"我现在看的是哪条线"。
7. 作为使用者，我想在顶栏看到「另有 N 个已关闭」，以便知道关闭但未合入的 MR 有多少，而它们不占用列宽。

### 待我审（Review Queue）

8. 作为评审人，我想看到所有 `reviewers` 包含我、目标分支匹配、且我还没批准的 opened MR，以便不漏掉任何一个等我审的请求。
9. 作为评审人，我想在我点下 Approve 之后、下一轮刷新时看到这张卡从队列里消失，以便队列只表示"还需要我做事"。
10. 作为评审人，我想在卡片上看到提交者、源分支 → 目标分支、最后更新时间，以便判断先审哪一个。
11. 作为评审人，我想在卡片上看到 Jira key chip 并点击跳到 Jira issue，以便理解这个 MR 在交付什么。
12. 作为使用者，我想让没有 Jira key 的 MR 也照常显示（只是没有 chip），以便"没写 key"的 MR 不会凭空消失。
13. 作为评审人，我想让 Draft（WIP）的 MR 完全不出现，以便草稿不占用我的注意力。
14. 作为评审人，我想让队列按最后更新时间倒序，以便最新变动的 MR 排在最前面。

### 我提交的（My MRs）

15. 作为提交者，我想看到所有 author = me 的 opened MR（不受 assignee 字段影响），以便跟踪我自己提的每一个改动。
16. 作为提交者，我想在卡片上看到 `未审` 或 `已审（N 人）` 徽章，以便判断这个 MR 有没有人看过。
17. 作为提交者，我想在卡片上看到批准人名单，以便知道是谁批的、还差几个人。
18. 作为提交者，我想在 MR 被合入后看到它从看板上消失，以便"我提交的"永远是尚未合入的工作集。
19. 作为提交者，我想让被关闭（未合入）的 MR 也不占列，只在顶栏计数，以便列的语义保持干净。

### 事实与降级

20. 作为使用者，我想在 GitLab token 缺失、权限不足或网络失败时看到明确的错误条幅并保留上一份成功数据，以便不会把"取不到数"误读成"没有 MR"。
21. 作为使用者，我想在 `/approvals` 取数失败时看到 `审批未知` 而不是 `未审`，以便不会因为一次接口抖动就误判某个 MR 没人看。
22. 作为使用者，我想在审批未知时这张卡仍留在 `Reviewer 包含我` 列，以便宁可多显示一张卡，也不漏审。
23. 作为使用者，我想在首次加载时看到骨架屏而不是空列，以便知道是"还在取数"而不是"真的没有"。
24. 作为使用者，我想在两列都为空时看到明确的空态文案（例如"没有待你审的 MR"），以便确认功能是好的。

### 详情与操作

25. 作为使用者，我想左键点卡片弹出详情浮层，看到标题、状态、源 → 目标分支、批准人名单、创建/更新时间、Jira key 列表，以便不离开编辑器就掌握全部事实。
26. 作为使用者，我想在浮层里点「在 GitLab 中打开」跳到 MR 页面，以便做看板不支持的写操作（Approve、评论、合并）。
27. 作为使用者，我想在浮层里点「用 Qoder 审查此 MR」触发与右键相同的评审交接，以便不用记右键。
28. 作为使用者，我想让所有卡片都有右键菜单（`用 Qoder 审查此 MR` / `在 GitLab 中打开` / `复制链接`），以便操作位置固定、可预测。
29. 作为使用者，我想让 `用 Qoder 审查此 MR` 只在 `Reviewer 包含我` 的卡片上可用，以便不会误对自己提交的 MR 触发"评审自己"。
30. 作为使用者，我想在点「复制链接」后剪贴板里是 MR 的 web URL，以便能贴到 IM 或邮件里。

### 评审交接（Review Handoff）

31. 作为评审人，我想在右键「用 Qoder 审查此 MR」后，工作区里出现这个 MR 的 diff 文件，以便评审有确定的输入，而不是靠 agent 自己去猜从哪取。
32. 作为评审人，我想剪贴板里是一条可直接发送的 `/code-review` 指令，包含 MR 编号、链接和 diff 文件路径，以便粘贴后只需要回车。
33. 作为评审人，我想在复制成功后看到一条提示，说明"打开 Qoder 新会话 → 粘贴 → 回车"，以便知道下一步该做什么。
34. 作为评审人，我想让 diff 拉取失败时得到明确的错误提示（并提供一次"只复制链接"的退路），以便评审不会因为一个接口 404 就彻底卡住。

### 运行与刷新

35. 作为使用者，我想让 `GitLab Board` 按独立配置的间隔（默认 90 秒）轮询，以便 MR 变化慢的时候不用每 45 秒打一次 GitLab。
36. 作为使用者，我想让面板在后台时停止轮询、回到前台立刻刷新一次，以便不浪费请求，同时切回来时数据是新的。
37. 作为使用者，我想点顶栏「刷新」立刻重新取数，以便刚 Approve 完就能确认卡片出列。
38. 作为使用者，我想从 PC Board 的入口页直接打开设置，以便不用去扩展列表里翻。
39. 作为使用者，我想在设置页面用「仓库@分支」一行文本直接输入取数范围，以便不必跳去 settings.json 编辑对象数组。
40. 作为使用者，我想让 Jira 与 GitLab 的设置分成两个分组，以便一眼分清哪项属于哪块看板。

## Implementation Decisions

### 命名与入口

- 扩展 `displayName` 与活动栏容器标题改为 `PC Board`；扩展 id 仍为 `your-name.todo-panel`，不改变安装身份。
- 两块面板标题分别为 `Jira Board`、`GitLab Board`。
- 新增命令 `todoPanel.openMrBoard`；活动栏入口页在「打开 Jira 看板」下面追加「打开 GitLab 看板」。点活动栏图标的行为保持不变（默认开 Jira Board）。

### 面板与状态

- 新增一个与 `BoardPanel` 平级的面板类（`MrBoardPanel`），只负责窗口与消息管道；HTTP、剪贴板、文件写入全部留在扩展进程。
- 新增 `MrBoardState`，复用 Jira 看板已验证的骨架：`refresh / republish / setVisible / dispose / publish(force)`、按数据指纹抑制重绘、`lastSuccessAt` 按分钟进指纹、首轮先推 `loading`。
- 轮询用 `setTimeout` 递归，天然不重叠；面板不可见时清表。
- 取数失败保留上一份成功数据，只把 `stale / error / notices` 翻上去（与 Jira 看板一致）。

### 配置

Settings UI 里分两个分组（`contributes.configuration` 是数组，而不是一个统一标题）：

- `PC Board: Jira` —— `boardId` / `projects` / `onlyMineByDefault` / `pollIntervalSec` / `buildCheckIssueTypes` / `extraIssueKeys` / `devMode` / `repos`。
- `PC Board: GitLab` —— `mrBoard.scopes` / `mrBoard.pollIntervalSec`。

取数范围用**字符串数组**而不是对象数组：`todoPanel.mrBoard.scopes`，每行一条 `仓库路径@目标分支`，默认 `["ultrasoundgeneralimaging/gipc-app@nexus/dev/7.10.x"]`。Settings UI 对 `array<string>` 会直接给出「添加项 + 输入框」；`array<object>` 只能跳去 settings.json。解析按最后一个 `@` 切分，空行跳过，重复折叠，写法不对的行进 `invalidScopes` 并在看板上提示，不静默丢弃。旧的 `todoPanel.mrBoard.repos`（对象数组）不再出现在 UI，但作为兼容回退继续读取。

`mrBoard.pollIntervalSec` 默认 `90`，钳制在 30–300 之间。不新增 `enabled` 开关，也不读 `todoPanel.repos`——两块看板的取数范围互不影响。

入口页（活动栏 `PC Board`）在三处链接中给出「打开设置」，对应命令 `todoPanel.openSettings`：执行 `workbench.action.openSettings` 并带 `@ext:<extension id>` 过滤，直接落到本扩展的两个分组。

### 领域模型

新增一组只属于 MR 看板的纯数据类型（不复用 `MrFact`：那个类型表达的是"某 issue 的交付证据"，缺少 author / reviewers / draft / createdAt）：

```ts
type ReviewState = 'awaiting-me' | 'unreviewed' | 'reviewed' | 'unknown';
type MrColumn = 'review-queue' | 'my-mrs';

interface MrBoardCard {
    iid: number;
    title: string;
    url: string;
    projectPath: string;      // 多仓库时用于区分
    sourceBranch: string;
    targetBranch: string;
    author: Person;           // name / username / avatarUrl
    approvedBy: Person[];
    approvalsLeft: number | null;
    approvalsKnown: boolean;  // false = /approvals 失败，禁止推断
    createdAt: string;
    updatedAt: string;
    reviewState: ReviewState;
    jiraKeys: string[];
}
```

`ReviewState` 的语义边界：

- `awaiting-me`：`reviewers` 含我 且 我未批准。只出现在 `review-queue` 列。
- `reviewed`：`approvedBy` 里存在我以外的人。
- `unknown`：`/approvals` 取数失败。**不得降级成 `unreviewed`**。
- `unreviewed`：审批已取到且没有我以外的人批准。

### 分类器（单一 seam）

新增一个纯函数模块（`MrBoardResolver`），输入全部事实，输出两列卡片与计数：

```ts
interface ClassifyInput {
    mrs: RawMrFact[];              // 该（repo, branch）下 state=all 的原始事实
    viewerId: number;              // /user 的 id
    approvals: Map<number, GitlabApprovals | undefined>;
    jiraProjects: string[];        // key chip 的白名单
}

interface ClassifyResult {
    reviewQueue: MrBoardCard[];
    myMrs: MrBoardCard[];
    closedCount: number;
    unseenCount: number;           // 服务端过滤失效、但本地复核不通过的条数
}
```

规则（全部在这一处实现，UI 只渲染）：

1. 只要 `state === 'opened'`；`merged` 丢弃且不计数；`closed` 只累加 `closedCount`。
2. `draft === true`（或 `work_in_progress === true`）丢弃，不计数、不提示。
3. `review-queue` 入列条件：`reviewers[].id` 包含 `viewerId`，且 `approvals.get(iid)?.approvedBy` 不含 `viewerId`；`approvals` 为 `undefined` 时仍然入列（宁可多显示）。
4. `my-mrs` 入列条件：`author.id === viewerId`。
5. 同一 iid 同时满足两列时只进 `review-queue`（自己给自己提 MR 且自任 reviewer 的极端情况也不重复）。
6. 两列分别按 `updatedAt` 倒序；相同时按 `iid` 倒序。
7. Jira key 提取复用现有 `extractJiraKeys`（标题 → 描述 → 源分支，白名单长 key 在前）。
8. `unseenCount` 用于暴露"服务端 `reviewer_id` 参数被忽略"的风险：请求里带 `reviewer_id` 后仍按第 3 条本地复核，复核掉的条数计入该字段，只用于诊断日志，不上界面。

### GitLab 取数契约

`GitLabService` 增加三个只读方法（不复用 `listTargetBranchMrs`，那个方法的语义被"交付证据"绑死了）：

- `getCurrentUser(): Promise<{ id: number; username: string; name: string }>` — `GET /api/v4/user`。
- `listMrsForUser({ project, targetBranch, userId, role: 'reviewer' | 'author' })` — 单次列表请求：
  `state=opened&target_branch=<branch>&reviewer_id=<id>`（或 `author_id`）`&per_page=100&order_by=updated_at&sort=desc`，
  翻页上限 2 页；返回行里必须包含 `author`、`reviewers`、`draft`/`work_in_progress`、`created_at`。
- `getApprovals(project, iid)` — 复用现有实现（`approved === true` 才算批准；失败返回 `undefined`）。

取数顺序：先取 `/user`（缓存到会话生命周期），再对每个 `(repo, branch)` 并发发两条列表请求（reviewer / author），按 `iid` 去重后对所有 opened MR 并发查 `/approvals`（并发上限 4）。

**禁令**：不得用 `detailed_merge_status` 判断"是否需要我审"或"是否已批准"；不得用 `approved_by.length > 0` 代替 `approved === true` 之外的语义判断。

### 评审交接

右键 `用 Qoder 审查此 MR` 的动作序列（全部在扩展进程）：

1. 用同一 token 拉 `GET /api/v4/projects/:id/merge_requests/:iid/diffs`（逐页，最多 3 页）。
2. 把**统一 diff 文本**写到工作区 `.scratch/mr-board/diffs/!<iid>.diff`（目录不存在则创建；同名覆盖）。失败时降级为"只复制链接"并在提示里说明。
3. 生成剪贴板文本，交由 `vscode.env.clipboard.writeText`：
   - 正常：`/code-review 审查 GitLab MR !<iid>（<title>），链接 <url>，diff 已保存到 <绝对路径>。只审这个 MR 的改动，不要审当前工作区。`
   - 降级：`/code-review 审查 GitLab MR !<iid>（<title>），链接 <url>。用 scrum-buddy 的 gitlab_get_mr_diff 取 diff，不要审当前工作区。`
4. `showInformationMessage` 提示："审查指令已复制。打开 Qoder 聊天新会话（Ctrl+N）→ 粘贴 → 回车。"

**不调用** `vscode.commands.executeCommand('workbench.action.newChat')`：它是聊天 WebView 的内部命令表项，不是 VS Code 命令，调用只会报 command not found。

### 界面

- 顶栏：品牌 `GitLab Board` + 仓库/分支 chip（多条并列）+ 「另有 N 个已关闭」+ 同步时间 + 刷新。
- 两列布局沿用 Jira 看板的列样式；列头显示计数。
- 卡片：`!iid` + 更新时间 / 标题 / 作者（第一列）或批准人（第二列）/ 状态徽章 / Jira key chip。Draft 到不了这一层——分类前已丢弃。
- 徽章文案：`待我审`、`未审`、`已审（N 人）`、`审批未知`。
- 左键：详情浮层（字段 + 「用 Qoder 审查此 MR」「在 GitLab 中打开」）。
- 右键：自定义上下文菜单，三项；`用 Qoder 审查此 MR` 在第二列置灰。
- 空态：两列都空时显示「没有待你审的 MR / 你提交的 MR 都已合入」这类明确文案；首屏加载复用骨架屏。

### 构建

WebView 打包管线从单入口扩成双入口：同一份 esbuild 配置产出两个 bundle（Jira 看板与 MR 看板各一个），HTML 模板只从 `media/` 以 `asWebviewUri` 加载脚本——**脚本绝不内联进模板字符串**（模板字符串会吞掉正则反斜杠，历史事故见 ADR 前例）。

## Testing Decisions

### Seams

只新增两个可测 seam，且都在**最高点**：

1. **分类器**（`MrBoardResolver.classify`）——纯函数，输入原始 MR 事实 + viewer + approvals，输出两列卡片、关闭计数、诊断计数。所有列归属、徽章、Draft/merged/closed 过滤、排序、去重规则都只在这里断言，UI 与 HTTP 不参与。
2. **评审指令构造器**（`buildReviewRequest`）——纯函数，输入 MR 摘要 + diff 路径（或 undefined），输出剪贴板文本。断言正常/降级两种文本形态。

不新增 HTTP 层 seam：仓库现有测试一律不打网络（`stage-resolver` / `key-matcher` / `mr-association` / `jenkins-path` / `state` 全是纯函数或纯状态机），保持一致。

### 什么算好测试

只断言**对外可观察的行为**：给定事实集合 → 两列内容、每张卡的 `reviewState`、计数与顺序。不断言内部字段名、不断言请求次数、不 mock 私有方法。

### 测试清单（分类器）

- `merged` 不出现且不计入 `closedCount`；`closed` 计入 `closedCount` 但不入列。
- `draft` 完全不可见，且不影响计数。
- reviewer 含我且我未批准 → `review-queue`。
- reviewer 含我但我已在 `approvedBy` 里 → 不出现在任何列。
- `approvals` 为 `undefined` → 仍入 `review-queue`，`reviewState = 'unknown'`。
- author = me → `my-mrs`；author 不是我、assignee 是我 → 不出现。
- 我提交且别人已批 → `reviewed` + `已审（1 人）`。
- 我提交且无人批 → `unreviewed`。
- 同一 iid 同时是 reviewer 与 author → 只进 `review-queue`。
- 两列各自按 `updatedAt` 倒序，同时间按 `iid` 倒序。
- 标题含 `NEX2-1038+1039` → chip 得到两个 key（复用现有 key 匹配规则）。
- 标题无 key、分支名无 key → `jiraKeys` 为空，卡片照常存在。

### 测试清单（指令构造器）

- 有 diff 路径：文本包含 `/code-review`、`!iid`、MR URL、绝对路径、"不要审当前工作区"。
- 无 diff 路径：文本包含 `gitlab_get_mr_diff`，不包含本地路径。

### 先例

`test/stage-resolver.test.ts` 是模板：构造 `Partial<T>` 工厂函数 + 逐条行为断言；`test/key-matcher.test.ts` 覆盖 key 白名单与前缀继承，直接复用其数据。

## Out of Scope

- 写回 GitLab：Approve、评论、合并、修改标题——全部留在 GitLab 网页。
- 本地仓库检出与"带上下文"的评审（`localPath` + `-w` 方案）——记为后续项，本期只做 diff 级评审。
- 自动打开或预填 Qoder 聊天会话（宿主未提供扩展 API）。
- 默认展示 `nexus/dev/5.10.x`；需要时由使用者自己加一条配置。
- 桌面通知 / 声音提醒 / IM 推送。
- 跨仓库的 MR 汇总统计（如"我本周审了多少"）。
- 在 Jira Board 上扩展 MR 相关的展示（现有 Delivery Stage 行为不变）。

## Further Notes

- **不要复用 `Delivery Stage`**：它的阶梯把 `merged` 当"走到的阶段"，而 MR Board 把 `merged` 当退场条件。两者共存但语义不同，词条见 `GLOSSARY.md`。
- **审批判据的教训**（来自既有实现）：`approved_by` 只在 `/approvals` 端点存在；`detailed_merge_status` 是复合语义，merged 时为 `not_open`，不能当审批判据；"有人批准"≠"整张 MR 已批准"。
- **`reviewer_id` 参数不可盲信**：若 GitLab 版本忽略该参数，会把整个分支的 opened MR 都返回。分类器第 3 条的本地复核是硬要求，不是优化。
- **diff 文件会累积**：`.scratch/mr-board/diffs/` 每次审查覆盖同名文件，但不自动清理历史 iid；属于可接受的本地痕迹，暂不加入清理任务。
- **版本号策略**：按既有约定，迭代期间不递增版本号，功能验收时统一升版。
- **命名**：扩展身份（`your-name.todo-panel`）不变，只改 `displayName` 与容器标题，已安装用户无需重装即可看到新名字。
