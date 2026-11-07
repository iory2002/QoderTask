# Jenkins job 映射与 SHA 可用性

Type: task
Status: resolved

## Question

凭证已经在 `~/.scrumbuddy/config.json` 的 `jenkins` 段里（`baseUrl` / `username` / `token`），缺的是「这是哪个 job、构建了哪个 rev」。这张票不决策，只把事实摸清楚，让构建阶段的判定规则能落地。

需要确认：

1. **job 路径结构**：multibranch pipeline（`job/<repo>/job/<branch>`）还是固定 job + 分支参数？中间有没有 folder 层级？
2. **job ↔ 仓库/分支的对应关系**：一个 job 管一个仓库还是多个？目标分支（master/main）是否各自独立 job？
3. **rev 是否可读**：`/job/<name>/api/json?tree=builds[number,result,timestamp,actions[lastBuiltRevision[rev]]]` 里 `lastBuiltRevision.rev` 有没有值。这是「SHA 精确匹配」能否成立的前提。
4. **触发方式**：merge 之后是 webhook 自动触发还是人工点构建？决定「已合入待构建」会不会长期挂起。
5. **失败语义**：构建失败后会不会有重试 build（同一 rev 多个结果）？取最后一个还是任一成功。

## 交付

一份 job 映射表（Jira 项目 / GitLab 项目 / Jenkins job 路径 / 目标分支）+ 一条可直接跑的 curl 示例。若第 3 条拿不到 rev，构建判定必须退化为纯时间窗，需要回来更新 map。

## 已探明（2026-11-07，只读探测）

详见 [research/03-jenkins-mapping.md](../research/03-jenkins-mapping.md)。要点：

- Jenkins 可达，但**自签证书**：Node 原生 `fetch` 报 `fetch failed`，必须 `https` + `rejectUnauthorized:false`。
- 顶层 26 个 folder 按**产品线**组织（Mainline / R5 / R4 / LE9 / …），两个 OrganizationFolder 自动发现 GitLab 仓库。
- 抽样 job `Base-and-patch/BaseImagePayload` 的构建里**没有 `lastBuiltRevision`**。
- 扫了 7 个 folder 共 42 个子 job，**没有任何名字含 nex / magr / ib / nexus**。

## 还缺（只有用户知道）

- NEX2 / NEX / MAGR3 / IB 分别由哪个 job 构建（给一个 job URL 即可）。
- 是否 multibranch、目标分支是否独立 job。
- 构建里能否读到 rev。

拿到一条 job URL 即可关闭本票。

## Answer

已拿到 job：`UltrasoundGeneralImaging / ultrasoundgeneralimaging%2Fgipc-app / nexus%2Fdev%2F7.10.x`。完整数据见 [research/03-jenkins-mapping.md](../research/03-jenkins-mapping.md)。

三条决定（推翻原计划）：

1. **SHA 精确匹配不可行**。`lastBuiltRevision` 只有分支名无 rev；`changeSet` 为 0 条；`GITLAB_COMMIT_ID` 参数连续 8 次全为空。构建只能走**时间窗**判定。
2. **「已构建」天然滞后半天到一天**。每天 04:07 / 14:00 两次启动，单次 5～20 小时。所以 `已合入待构建` 是常态，推 In Test 的闸门不能卡在构建上（与 09 号票一致）。
3. **job 必须显式配置**。Jenkins 按产品线组织、仓库叫 `gipc-app`，与 Jira 项目名零关联。配置形如 `{ jiraProject, gitlabProject, jenkinsJob, targetBranch }`。NEX2 那条已确定：repo `ultrasoundgeneralimaging/gipc-app`，target branch `nexus/dev/7.10.x`。MAGR3 / NEX / IB 待补对应 job URL。

其他实现约束：自签证书（`rejectUnauthorized:false`）、job 路径每段都要 `encodeURIComponent`、`result = null` 的进行中构建不能当失败。
