# Jira Board

在 QoderCN 的编辑器标签页里看 Jira 看板：五列取自 Jira board 配置，卡上挂 GitLab / Jenkins 的交付事实。**只读**——改状态请到 Jira。

> **本地待办已下线（不可逆）**：这个扩展以前是一个本地待办侧边栏，`.todo-data.json` 里的数据不再读写，也没有导出功能。入口换成了活动栏的两个图标：**Jira Board** 与 **GitLab Board**。

## 功能

- **五列看板** — 列与列的 status 集合来自 `GET /rest/agile/1.0/board/{id}/configuration`，不在插件里写死。
- **卡片** — 活跃 sprint ∩ 项目白名单，按 Jira Rank 升序；显示 key、标题、类型、优先级、Epic chip、评论数；子任务带「子」角标。默认「只看我的」（在顶栏「视图」菜单里切换），关掉后显示全量并带经办人头像。**「只看我的」与项目 chip 都是纯视图过滤**：数据始终一次全量拉取，切开关不会重新请求；只有点「刷新」才重新取数。
- **视图菜单** — 顶栏「视图」：`只看我的`、`显示列`（二级菜单勾选要看的列，写回 `pcBoard.hiddenColumns`）、`详细 / 精简`。精简卡片只保留类型图标、key、子任务「子」、经办人头像与阶段徽章。全部是纯视图开关：不重新取数，角标与各类计数不变；`详细 / 精简` 记在全局偏好里。
- **交付阶段徽章** — `未提交` / `MR 待审` / `已 Approve 待合入` / `已合入待构建` / `已构建`，构建失败另挂 `Build failed`；取数失败显示 `无法判定`（绝不假装「未提交」）。**阶段按「本轮」算**：一张卡关联多个 MR 时取最新那个，不取历史最高——返工时旧 MR 已合入并进过构建，新 MR 才是当前进度。Jira 状态退回开发（默认 `In Progress` / `Reopened` / `In Rework` / `Test Failed`）、上一轮确实已构建、而本轮还没有新 MR 时显示 `返工中`，不再显示上一轮的 `已构建`；详情里保留上一轮的 MR 与构建号。MAGR3 / IB 不接代码托管，不出徽章；**没有配置 GitLab 凭据时一律不出阶段徽章**（否则每张卡都是「无法判定」），详细 / 精简都一样。
- **详情浮层** — 点卡片看阶段事实链：命中的 MR、批准人、合入时间、构建号与绝对时间、推导依据，以及「在 Jira 中打开」。
- **只读，不改状态** — 看板不做拖拽：Jira 的 transition 大多带必填字段（screen），插件里填不了，硬做只会卡在半路。改状态请点卡片详情里的「在 Jira 中打开」。
- **活动栏角标** — 两个图标各带一个数字：Jira 图标显示「开发中」或「测试中」的未完成卡数（设置里选），GitLab 图标显示「待我审」或「等别人审」的 MR 数。另一个数字在侧边栏条目里显示——一个活动栏图标只有一处数字位。

## 环境要求

- [QoderCN IDE](https://www.qoder.com)（VS Code 1.106 分支）
- Node.js 18+（仅构建时需要）
- ScrumBuddy 配置 `~/.scrumbuddy/config.json`

### 用 run-qodercn.cmd 启动 IDE

内网 Jenkins / GitLab 的证书由 GE HealthCare 自签根签发，Node 自带的 CA 库里没有，
默认校验必然失败（`unable to verify the first certificate`）。Node 只在**进程启动时**读
`NODE_USE_SYSTEM_CA`，扩展内运行时再设无效，所以要用仓库根目录的 `run-qodercn.cmd`
启动 IDE——它会设好环境变量再拉起 IDE。

链校验仍然生效（走 Windows 系统证书库），只放行主机名比对：内网证书的 SAN 里只有
`ulsgi-bm.avs.uswau.lab.ge-healthcare.net`，没有我们实际请求的 `ulsgi-bm.lab.ge-healthcare.net`。

### 扩展在不受信任的工作区

扩展声明了 `capabilities.untrustedWorkspaces.supported`，因此在未信任的工作区也能启用
（它不读写工作区文件，只用 `~/.scrumbuddy/config.json` 里的凭据访问内网服务）。

### 凭据配置

凭据沿用 ScrumBuddy 的配置文件，**不迁移、不复制**，`enc:` 前缀的密文会自动用 AES-GCM 解密：

```json
{
  "jira": { "baseUrl": "http://jira-host:8080", "username": "you", "password": "..." },
  "gitlab": { "baseUrl": "https://gitlab-host", "token": "..." },
  "jenkins": { "baseUrl": "https://jenkins-host:8443", "username": "you", "token": "..." }
}
```

`gitlab` 与 `jenkins` 只在你配置了对应 repo 条目时才需要。

### 扩展设置

```jsonc
"pcBoard.boardId": 23,
"pcBoard.projects": ["NEX2"],
"pcBoard.onlyMineByDefault": true,
"pcBoard.hiddenColumns": [],
"pcBoard.pollIntervalSec": 60,
"pcBoard.buildCheckIssueTypes": ["Story", "Bug", "In-Sprint Bug"],
"pcBoard.reworkStatuses": ["In Progress", "Reopened", "In Rework", "Test Failed"],
"pcBoard.extraIssueKeys": [],
"pcBoard.devMode": false,
"pcBoard.repos": [
  {
    "jiraProjects": ["NEX2"],
    "gitlabProject": "ultrasoundgeneralimaging/gipc-app",
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

**「有没有 repo 条目」就是阶段追踪开关**：没有条目的项目（例如 MAGR3 / IB）不计算阶段、不出徽章，也不告警。`jenkinsJobPath` 为 `null` 时阶段顶格在「已合入」，不会挂在等构建上。

**隐藏不关心的列**：`pcBoard.hiddenColumns` 填要看板上隐藏的列名，例如 `["To Do", "In Progress"]`；大小写与空格不敏感，也可以填列 id。也能在看板顶栏「视图 → 显示列」里直接勾选（勾选结果就写回这个设置）。这是**纯展示开关**：卡片仍然全量拉取，活动栏角标、顶栏总数、列外状态计数都不变，隐藏 To Do / In Progress 不会改变「开发中」的数字。留空 = 显示看板的全部列；列名没匹配上时看板顶部会提示当前有哪些列。

**项目白名单决定看板看到什么，也决定发不发请求**：默认只有 `NEX2`。白名单外的 repo 映射（例如 NEX 那条）会保留但**不发请求**，把项目加回 `pcBoard.projects` 即可重新生效。

**只有写代码的类型才看构建**：默认 `Story`、`Bug` 与 `In-Sprint Bug`（测试退回后开的子 bug）。其余类型（`Task`、`Sub-task`）不查 Jenkins，阶段顶格在「已合入」——它们不做构建，盯着构建会永远挂着。仓库里没有任何需要构建校验的卡片时，连 Jenkins 请求都不会发。类型名按大小写不敏感精确匹配；其他变体需要显式加进 `pcBoard.buildCheckIssueTypes`。

**返工与子任务**：`pcBoard.reworkStatuses` 定义哪些 Jira 状态算「已退回开发」，默认 `In Progress`、`Reopened`、`In Rework`、`Test Failed`（大小写与首尾空格不敏感）。子任务只在**不写代码**时才继承父任务阶段；名字带 Bug 的类型（含作为子任务开的 `In-Sprint Bug`）一律按自己的 MR / 构建算，不会跟着 Story 显示「已构建」。因此修复 MR 的标题 / 描述 / 源分支要带上对应子 bug 的 key，否则它关联不到 MR，会停在「未提交」。

**钉住还没进 sprint 的 issue（仅 dev）**：先在 `pcBoard.extraIssueKeys` 里填 key（如 `["NEX2-610"]`），再把 `pcBoard.devMode` 打开（在设置里，顶栏不提供开关），它才会绕开 sprint 与「只看我的」出现在看板上，阶段照常算。devMode 关掉后钉住名单直接失效，看板回到 `sprint ∩ 项目白名单` 的干净状态。

`jenkinsJobPath` 用 `/` 分段，每段填**已经编码过一次**的 job 名（分支里的 `/` 写作 `%2F`），插件会再编码一次（URL 里是 `%252F`）。

**活动栏角标**：`pcBoard.badge.jira.mode` 选 Jira 图标显示「开发中」还是「测试中」，`pcBoard.badge.gitlab.mode` 选 GitLab 图标显示「待我审」还是「等别人审」；两个数字都在侧边栏条目里显示。哪两组状态算未完成由 `pcBoard.badge.jira.developmentStatuses` / `pcBoard.badge.jira.testingStatuses` 决定，按状态名匹配、大小写不敏感；`pcBoard.badge.jira.onlyMine` 控制是否只算自己的。`pcBoard.badge.jira.pollIntervalSec` / `pcBoard.badge.gitlab.pollIntervalSec` 是两个角标在看板面板没打开时的刷新间隔（默认各 60 秒）。

切 `mode` 只改显示口径：两组数字本来就是同一批卡片算出来的，改完设置角标与侧边栏标签立刻互换，**不会重新取数**，不用等下一轮轮询。改 `onlyMine` 或两组状态名单同理。

## 打开看板

1. 点活动栏的 **Jira Board** 图标 —— 编辑器区会出现一个 `Jira Board` 标签页；再点一次聚焦同一个标签，不会重复开。
2. 点活动栏的 **GitLab Board** 图标 —— 同理打开 `GitLab Board` 标签页。两个侧边栏条目各开各的，不再互相跳转。
3. 标签被关掉后，命令面板执行 **Jira Board: Open Board** / **GitLab Board: Open Board**。
4. 命令面板的 **Jira Board: Refresh** 立即重拉一次。
5. 侧边栏条目里的「打开设置」直接定位到本扩展的 Jira / GitLab 配置。

## 构建与安装

```bash
npm install
npm run package     # 编译 + 校验 media/board.js + 打 vsix
```

`media/board.js` 是 WebView 的打包产物；产物缺失或过小时 `npm run package` 会直接失败，避免发出一个白屏看板。

安装：

```powershell
& "C:\Program Files\QoderCN\bin\code.cmd" --install-extension todo-panel-1.0.1.vsix --force
```

> 必须用 QoderCN 自己 `bin` 下的 **`code.cmd`**（它就是 IDE 的 CLI，内部以 `ELECTRON_RUN_AS_NODE` 跑 `resources/app/out/cli.js`）。
> 不要用全局 `code`（那是 VS Code）；也不要用 `bin\qoder-cn.cmd`——那个是 Qoder 的 **agent CLI** 桥接，不认 `--install-extension`，会报 `unknown option`。
> IDE 正在运行时扩展目录被占用，安装可能报 EPERM/EBUSY，先完全退出 IDE（Ctrl+Q）或用 `install.ps1`。

## 开发

```bash
npm test            # 纯逻辑单测：阶段判定 / key 匹配 / MR 关联 / 数据指纹
npm run watch       # 扩展侧 tsc watch
npm run watch:webview   # WebView 侧 esbuild watch
```

设计基线见 `.scratch/jira-board/`（spec 与实测研究），实现票见 `.scratch/jira-board-impl/`，术语见 `GLOSSARY.md`。

## 结构

```
src/
├── extension.ts                 # 激活、命令、外部链接
├── board/
│   ├── BoardPanel.ts            # WebviewPanel + 消息管道
│   ├── BoardEntryView.ts        # 活动栏入口
│   ├── BoardState.ts            # 内存态、轮询、阶段编排
│   ├── config.ts                # pcBoard.* 设置
│   ├── fingerprint.ts           # 数据指纹（纯函数）
│   └── errors.ts                # 错误 → 人话
├── models/Board.ts              # 扩展与 WebView 共享的类型
└── services/                    # Jira / GitLab / Jenkins / 阶段判定 / key 匹配
webview/                         # Preact 应用（esbuild → media/board.js）
media/                           # 打包产物与样式
test/                            # node:test 单测
```

## License

MIT
