# Jira Board

在 QoderCN 的编辑器标签页里看 Jira 看板：五列取自 Jira board 配置，卡上挂 GitLab / Jenkins 的交付事实，拖一下就能把状态推进一步。

> **本地待办已下线（不可逆）**：这个扩展以前是一个本地待办侧边栏，`.todo-data.json` 里的数据不再读写，也没有导出功能。入口换成了活动栏的 **Jira Board** 图标。

## 功能

- **五列看板** — 列与列的 status 集合来自 `GET /rest/agile/1.0/board/{id}/configuration`，不在插件里写死。
- **卡片** — 活跃 sprint ∩ 项目白名单，按 Jira Rank 升序；显示 key、标题、类型、优先级、Epic chip、评论数；子任务带「子」角标。默认只看指派给自己的，关掉后显示全量并带经办人头像。
- **交付阶段徽章** — `未提交` / `MR 待审` / `已 Approve 待合入` / `已合入待构建` / `已构建`，构建失败另挂 `Build failed`；取数失败显示 `无法判定`（绝不假装「未提交」）。MAGR3 / IB 不接代码托管，不出徽章。
- **详情浮层** — 点卡片看阶段事实链：命中的 MR、批准人、合入时间、构建号与绝对时间、推导依据，以及「在 Jira 中打开」。
- **拖拽推进** — 合法目标由该 issue 自己的 transitions 决定（Story 先到 In Code Review，Bug/Task 直达 In Test，Task/Sub-task 可一步到 Done）；回退请到 Jira 网页。
- **表单写回** — 跨列后弹表单，字段按 issue 当前值预填，只提交你改动过的项；插件填不了的字段会直接指到 Jira。写回单卡单次，无批量操作。
- **软闸门** — 阶段没达标仍可推进，但会先列出缺什么再由你确认。

## 环境要求

- [QoderCN IDE](https://www.qoder.com)（VS Code 1.106 分支）
- Node.js 18+（仅构建时需要）
- ScrumBuddy 配置 `~/.scrumbuddy/config.json`

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
"todoPanel.boardId": 23,
"todoPanel.projects": ["MAGR3", "NEX", "NEX2", "IB"],
"todoPanel.onlyMineByDefault": true,
"todoPanel.pollIntervalSec": 45,
"todoPanel.repos": [
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

`jenkinsJobPath` 用 `/` 分段，每段填**已经编码过一次**的 job 名（分支里的 `/` 写作 `%2F`），插件会再编码一次（URL 里是 `%252F`）。

## 打开看板

1. 点活动栏的 **Jira Board** 图标 —— 编辑器区会出现一个 `Jira Board` 标签页；再点一次聚焦同一个标签，不会重复开。
2. 标签被关掉后，命令面板执行 **Jira Board: Open Board**，或点侧边栏里的「打开 Jira 看板」链接。
3. 命令面板的 **Jira Board: Refresh** 立即重拉一次。

## 构建与安装

```bash
npm install
npm run package     # 编译 + 校验 media/board.js + 打 vsix
```

`media/board.js` 是 WebView 的打包产物；产物缺失或过小时 `npm run package` 会直接失败，避免发出一个白屏看板。

安装：

```powershell
& "C:\Program Files\QoderCN\bin\qoder-cn.cmd" --install-extension todo-panel-0.3.0.vsix
```

> 不要用 `code --install-extension`，那会装到 VS Code 而不是 QoderCN。

## 开发

```bash
npm test            # 纯逻辑单测：阶段判定 / key 匹配 / MR 关联 / 拖拽合法性 / 表单 / 软闸门
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
│   ├── BoardState.ts            # 内存态、轮询、阶段编排、写回
│   ├── config.ts                # todoPanel.* 设置
│   ├── dropRules.ts             # 拖拽合法性（纯函数）
│   ├── transitionForm.ts        # 表单构建与改动收集（纯函数）
│   ├── softGate.ts              # 软闸门（纯函数）
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
