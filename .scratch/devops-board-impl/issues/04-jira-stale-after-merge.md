# 04: Jira 卡详情：合入后 N 天未推进

**What to build:** 代码已经合入、但 Jira 状态还停在开发中的卡，点开详情能看到「合入后 3 天未推进」。这是"我拖住的卡"唯一的可见入口，不占卡面。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 详情显示「合入后 N 天未推进」，阈值为 3 天且写死、不提供配置
- [x] 时间取该卡所有关联 MR 中最早的合入时间
- [x] 未合入、取数失败的卡不显示这一行（不写"未知"占位）
- [x] 单测覆盖边界：正好 3 天、跨时区输入

## Comments

- `src/services/StalledAfterMerge.ts`：`stalledAfterMerge(mrs, now)`，3 天写死；时间先过 `epochOf`，解析失败视为无合入。
- `BoardCard.mergedDaysAgo` 在 `applyResult` 里现算（子任务没有自己的 MR 时用继承来的那个）。
- 详情只在非 `null` 时渲染一行，不写「未知」占位。测试：`test/stalled-after-merge.test.ts`。

