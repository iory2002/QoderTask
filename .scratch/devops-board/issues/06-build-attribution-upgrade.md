# 06 构建阶段升级：把「已构建」从推断变成可证明

Type: grilling
Status: resolved
Blocked by: —

## Question

`research/probe-jenkins-attribution.js` 已证明：构建的 commit 在 `BuildData.lastBuiltRevision.SHA1`，GitLab 侧 `commit statuses` / `pipelines?sha=` 还能反查构建号。现有实现仍在用时间窗（`build.timestamp > mergedAt`）。要定升级到什么程度：

1. **判定规则**：`merge_commit_sha === lastBuiltRevision.SHA1` 才算"已构建"，还是"合入的 commit 是构建 SHA 的祖先"也算（需要 GitLab `compare`）？后者能覆盖"连续多次合入被同一次构建带走"——这在本环境是常态（一天两次构建）。
2. **"构建中"要不要变成一等状态**：现在卡上仍是"已合入待构建"，"进行中"只写在推导依据里。加第六级 `构建中 #246（已 8h）`，还是保留五级 + 一个独立徽章？GLOSSARY 的阶梯要不要改（会影响 `DeliveryStageResolver` 的排序与所有测试）。
3. **归属粒度**：一次构建带走了 5 张卡，是 5 张卡都显示这个 build，还是只有"最后一次合入"显示？详情里要不要列出"同批次的其它卡"（这是 SHA 反查的红利）。
4. **降级**：老构建没有 SHA（早于本次改动）、`compare` 失败、GitLab statuses 缺失时，退回时间窗并明确标注"推断"。
5. **代价**：每个 repo 每轮多一次 `compare`（有缓存）。要不要只对"合入时间在最近 N 次构建窗口内"的 MR 做 compare。

## Answer

**2026-11-10 定稿。**

### 判定规则（一句话）

取该 repo 的**最新一次成功构建**，看它的 SHA：`merge_base(合入的 merge_commit, 最新成功构建的 SHA) === 合入的 merge_commit` ⇒ 卡为 `已构建`，否则为 `已合入待构建`。

- “之前”用**祖先关系**表达，不用时间先后（合入时间、构建启动时间、记录 SHA 的时机三者会错位）
- 只有 `SUCCESS` 算；`FAILURE`（如 #247）与进行中（如 #251）都不算
- 不再计算“最早一次包含它的构建”：用户只需要知道“最新一次成功构建里有没有我”

### 取数与成本

- 每个 repo 每轮只需拿到 `number / result / timestamp / actions[BuildData].lastBuiltRevision.SHA1`
- 逐卡判祖先，结果按 `(mergeSha, tipSha)` 缓存；**只有 tipSha 变了才重算**（实际一天 1~2 次），稳态自动刷新额外请求为 0
- 首次/新 SHA 时并发上限 4（复用 `GitLabService.mapWithLimit`）

### 展示

- 卡面：只写「已构建」，不写构建号——归因到“最新”意味着号会随每次重建往后漂，卡面写号码会每天变脸
- 详情浮层：`最新成功构建 #250（11-09 04:07 启动）包含本次合入`，附构建链接

### 边界（必须写进 GLOSSARY）

`已构建` = 有一次成功构建，**当时的代码树包含这个合入**。它**不等于**该构建产出的安装包里有它（产物来自构建开始时的代码树，而记录的 SHA 可能来自构建结束前的最后一次 checkout）。所以：可用于回答“代码进去没”，**不可**用作“可以送测”的依据。

### 降级

- 构建无 SHA（早于本次改动）、或 `merge_base` 失败 ⇒ 退回时间窗并明确标注「推断」
- 分支被 force-push / 历史重写 ⇒ 祖先关系断裂，卡会回退为「已合入待构建」；这是宁可漏报也不误报的方向
- GitLab `commit statuses` **不作为判据**：实测 3 个 merge commit 只有 1 个有回写（且是 running），它只覆盖“恰好是某次 checkout tip”的合入

### 明确不做

- **不加第六级「构建中」**：连徽章也不做，维持现状（“#251 仍在进行中”继续只出现在详情推导依据里）
- **不归因到最早构建**：已由“只要最新”取代
- **不做同批次互列与独立反向视图**：两者其实是同一份判定的副产品，随时可在详情里加一行；暂不进 backlog

### 证据

- `research/probe-jenkins-attribution.js`：`lastBuiltRevision.SHA1` 可读，console 有 `Checking out Revision <sha>`
- `research/probe-gitlab-ancestry.js`：`merge_commit_sha` 10/10 有值；`compare` 只认正向（反向=0 不是“相等”）；`merge_base` 是干净的祖先判定
- 构建表实测（#244~#251）：连续多次构建 SHA 相同（#244/#245、#246~#249），且 #246 记录的 SHA（`9d874314`，11-07 06:43 合入）晚于其启动时间（11-07 04:07）——构建内多次 checkout，记录的是最后一次

### 落地影响

- `JenkinsService`：tree 增加 `actions[_class,lastBuiltRevision[SHA1]]`，`BuildFact` 增 `sha`
- `GitLabService`：`MrFact` 增 `mergeCommitSha`（`GitLabMr` 已有，`toMrFacts` 目前丢掉了）；新增 `mergeBase(project, a, b)`
- `DeliveryStageResolver`：`built` 判定改为祖先关系；`evidence` 文案换成“最新成功构建 #N 包含本次合入”
- 测试：`stage-resolver.test.ts` 的阶段基线要改（时间窗→祖先），并补“同 SHA 多次构建”“FAILURE 不算”两个用例

