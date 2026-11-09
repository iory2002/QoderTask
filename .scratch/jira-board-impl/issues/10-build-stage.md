# 10: 构建阶段

**What to build:** 合入之后还能再往前走一格：这张卡的合入有没有被构建过、构建成功还是失败、是哪一次构建、什么时候。因为构建一天只跑两次、一次跑几小时，界面上必须能看出「这个结论有多旧」。

**Blocked by:** 05

**Status:** resolved

- [x] NEX2 与 NEX 的卡片，合入后有更晚的成功构建时，显示「已构建」并给出构建号与构建时间
- [x] 只有更早的构建时不显示已构建，停在「已合入待构建」
- [x] 构建正在进行中时既不算成功也不算失败
- [x] 构建失败时挂出可见的失败标记，同时阶段仍停在「已合入待构建」
- [x] 两条链路的 job 都能正确定位（NEX2 走 7.10.x 分支、NEX 走 5.10.x 分支）
- [x] 内网 Jenkins 的自签证书下能正常取数
- [x] 详情浮层补上构建号、构建的绝对时间、构建所在分支
- [x] 没有配置构建通道的项目不出构建相关徽章，也不出现「待构建」字样

## Comments

- `JenkinsService` 只做一件事：`GET {base}/job/{org}/job/{repo}/job/{branch}/api/json?tree=builds[number,result,timestamp]{0,20}`，Basic 认证 + `rejectUnauthorized:false`。
- 路径编码是唯一容易错的地方：配置里的 job 名本身含字面 `%2F`，所以每段还要再 `encodeURIComponent` 一次（URL 里是 `%252F`）。抽成 `encodeJobPath()` 并用 3 条单测钉死 7.10.x / 5.10.x 两条链路。
- 判定只能走时间窗（拿不到 commit）：合入时间之后存在 `result === SUCCESS` 的构建 → 已构建，展示的是**最后一次** SUCCESS（构建号 + 开始时间 + 分支）。
- 进行中（`result === null`）既不成功也不失败，只在依据里提一句；失败标记取「合入之后最后一个已完成的构建」，若它非 SUCCESS 就挂 `Build failed`，阶段仍停在「已合入待构建」。
- 构建是独立的一跳：`jenkinsJobPath` 配了但 Jenkins 取不到数（含未配置），该 repo 的卡片一律「无法判定」+ 顶栏横幅，不假装「已合入」。
- `jenkinsJobPath: null` → `buildChannel = 'merge-only'`，阶段顶格「已合入」（卡片文案不带「待构建」），也不显示 `Build failed`。
- 详情浮层的构建区展示构建号（可点开 Jenkins）、结果（进行中则写「进行中」）、绝对开始时间与分支；卡片徽章的 tooltip 也带完整依据，避免把 20 小时前的构建当成刚刚发生。
- **构建校验按 issue 类型分化**（用户补充）：只有 `Story` 与 `Bug` 看构建；`Task`、`Sub-task` 不查 Jenkins，阶段顶格在「已合入」。原因有两层：它们本就不走构建链路；若让 Jenkins 故障也作用于它们，一个 Task 会因为构建挂了而变成「无法判定」。
  - 类型名单进 `todoPanel.buildCheckIssueTypes`（默认 `['Story','Bug']`，大小写不敏感精确匹配）；`In-Sprint Bug` 这类变体需显式加入，不隐式按关键字匹配——宁可默认不包含，也不猜。
  - `resolveStage` 新增 `buildChecked` / `buildsOk` / `issueType`：`buildChannel === 'full' && !buildChecked` 时降级成 `merge-only`；Jenkins 取数失败只在「需要构建校验且已合入」时判 unknown，未合入的卡不受影响。
  - `applyStages` 里当仓库内没有任何需要构建校验的卡时，**连 Jenkins 请求都不发**。
  - 测试 +6：类型白名单、Task/Sub-task 顶格、Story 遇 Jenkins 故障为 unknown、Task 遇故障仍 merged、未合入卡不受 Jenkins 故障影响。
