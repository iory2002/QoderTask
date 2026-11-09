# 05: 构建归因改为 SHA 祖先判定

**What to build:** 卡片上的「已构建」只在"最新一次成功构建的代码树包含本次合入"时出现，并且详情写明是哪个构建、什么时候启动。取不到 SHA 时退回时间窗判断，并在界面上明确标注为「推断」。

**Blocked by:** 01（同一批取数代码，先落地翻页与 epoch 解析，避免并行改动打架）

**Status:** resolved

- [x] 判定改为祖先关系：合入的 merge commit 是构建 SHA 的祖先（或相等）才算包含
- [x] 只有 `SUCCESS` 算；`FAILURE` 与进行中的构建都不算「已构建」
- [x] 卡面不写构建号；详情写「最新成功构建 #N（启动时间）包含本次合入」并附链接
- [x] 构建无 SHA 或祖先判定失败 → 退回时间窗，并在详情标注「推断」
- [x] 阶段单测基线更新，新增"同一 SHA 被多次构建""FAILURE 不算"两个用例
- [x] 文档词汇同步：`已构建` 的含义与"不等于产物里有"这句边界写进术语表

## Comments

- `src/services/BuildAncestry.ts`：`merge_base(合入, 构建 SHA) === 合入` 判包含；三态 `true/false/null`，`null` 一律退回时间窗。结果按 SHA 对永久缓存。
- `JenkinsService` 的 tree 加 `actions[lastBuiltRevision[SHA1]]`，构建事实带 `sha`；`MrFact` 带 `mergeCommitSha`。
- 每轮只对「最新成功构建 + 最新已完成构建」问祖先关系（`buildsWorthChecking`），避免 20×N 的笛卡尔积把首屏拖死。
- `GLOSSARY.md` 补上「没有 SHA 时如何退回」的一段。提交 `5a47726`。

