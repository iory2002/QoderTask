# 07: 拖拽合法性判定

**What to build:** 卡片可以拖了，但能拖到哪由这张卡自己在 Jira 里可用的动作决定——不是「相邻列就能放」。放不下的时候说清楚为什么、该去哪。此阶段还不写 Jira。

**Blocked by:** 03

**Status:** resolved

- [x] Bug 从 In Progress 拖到 In Test 可以放下（这是 Jira 里真实存在的动作）
- [x] Story 从 In Progress 拖到 In Test 被拒绝，并提示只能先推到 In Code Review
- [x] Task 可以直接拖到 Done（对应它在 Jira 里的 Resolve）
- [x] 往回拖（例如 In Test 拖回 In Progress）被拒绝，提示回退要到 Jira 网页操作
- [x] 拖拽过程中，不可放的列有明确的视觉区别（不是拖到上面才报错）
- [x] 每次拖拽前重新获取该卡可用的动作，不跨交互复用旧结果
- [x] 拖放成功后卡片不移动（本阶段只做判定，不落状态），并有「这一步还不能写」的明确提示

## Comments

- 判定抽成纯函数 `src/board/dropRules.ts` 的 `computeDropRules()`，有 6 条单测直接钉住票里的三个类型差异（Bug 直达 In Test / Story 只能到 In Code Review / Task 一步 Done）与回退拒绝。
- 合法性来源：`GET /issue/{key}/transitions`，每次 `dragstart` 重新拉，`dragend` 清空，绝不跨交互复用。
- 禁止按列相邻推：合法 = 该 issue 现有 transition 的 `to.statusId` ∈ 目标列的状态集合。
- 视觉：拖拽开始后，非法列立刻加 `.locked`（整体降透明），鼠标悬停时合法列绿框（`.dragover`）、非法列红虚线（`.reject`）。非法列也 `preventDefault` 接收 drop，这样用户能拿到原因而不是"什么也没发生"。
- 原因文案三种：`卡片已经在这一列`、`看板不支持回退：需要回退请到 Jira 网页操作`、`没有直达「In Test」的动作；当前可去：In Code Review`。
- 本阶段合法落点只弹一条 toast（`可以推到「In Test」（Jira 动作：Send to Test）。这一步还不能写回 Jira。`），卡片不动；08 号票把这个分支换成表单。
