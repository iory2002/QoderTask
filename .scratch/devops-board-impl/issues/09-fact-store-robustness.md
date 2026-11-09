# 09: 库的健壮性：迁移、损坏重建、只读降级

**What to build:** 库需要升级、损坏、或被更高版本写过时，扩展都不崩：迁移前先备份、失败能回滚；库损坏时改名重建并明确告知历史已重置；库版本高于代码时进入只读模式而不是硬写。

**Blocked by:** 07

**Status:** resolved

- [x] `user_version` 迁移按顺序执行，每个迁移一个事务；迁移前生成备份，失败则回滚
- [x] 打开失败或完整性检查不通过 → 把原库改名为带时间戳的损坏文件、重建空库，并在板内提示"历史已重置"
- [x] 库版本高于代码版本 → 只读模式 + 提示"库来自更新版本"，不尝试降级迁移
- [x] 只读模式下功能仍可用（退回单窗口直连，见 10）
- [x] 单测覆盖三条路径：正常迁移、损坏重建、高版本只读

## Comments

- `FactStore.openWithStatus()` 返回 `{ store, status, message }`；两个看板的构造函数把 `message` 变成一条 `warn` 通知，用户能在板内看到。
- 迁移表 `MIGRATIONS`：第 i 项把库从 v i 推到 v i+1；每步 `BEGIN IMMEDIATE ... COMMIT`，失败 `ROLLBACK` 并保留原库。迁移前 copyFile 出 `.bak`（空文件不备）。
- 损坏：关掉句柄再改名（Windows 不允许改还开着的文件）→ `<db>.corrupt-<时间戳>`，原文件保留不删。
- 高版本：`readOnly: true` 重新打开，`transaction()` 一律返回 false；`user_version` 保持原值。
- 测试：`test/fact-store.test.ts` 三条路径。提交 `ce24631`。

