# 01: 取数不静默丢数据（翻页到空页 + 时间按 epoch 解析）

**What to build:** 打开任一看板时看到的卡片永远完整。GitLab 侧 90 天窗口内的 MR 全部纳入（当前 280 条，上限 300）；一旦被截断，顶栏明确告警而不是假装数据完整。所有来自服务端的时间在比较前统一成 epoch 毫秒，不再出现"提交时间晚于合入时间"这类结论。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 某仓库 90 天内 MR 超过 1000 条时，取数停止并给出"数据被截断"提示（不静默）
- [x] 90 天 280 条的真实场景下，已合入的卡不再退回「未提交」
- [x] 时间字段一律解析为 epoch ms 后再比较；单测覆盖 `+08:00` 与 UTC 混用的用例
- [x] 现有单测全绿

## Comments

- `src/services/paging.ts`：翻到不满一页为止，上限 10 页（1000 条），到上限后多探一页——恰好 1000 条不误报，超过才 `truncated: true`。
- `GitLabService.listTargetBranchMrs` / `listMrsForUser` 改为返回 `{ rows, truncated }`；两个看板各自把截断写成顶栏告警。
- `src/services/time.ts`：`epochOf` / `epochOrZero` / `isAtOrAfter`，阶段与排序的比较全部走它。
- 测试：`test/paging.test.ts`、`test/time.test.ts`。提交 `6dc4cda`。

