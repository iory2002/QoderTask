# 01 扩展宿主里能用哪种 SQLite，跨进程并发到什么程度

Type: research
Status: resolved
Blocked by: —

## Question

多开窗口共用一个事实库，第一块石头是**存储引擎**：QoderCN（VS Code 1.106 分支，Electron 42）的扩展宿主里，哪一种 SQLite 方案可用且可靠？

要回答清楚：

1. **扩展宿主的 Node 版本**是多少（`process.versions.node`），这是 `node:sqlite` 能不能用的前提（需要 ≥ 22.5，且要确认是否还需要 `--experimental-sqlite`）。
2. 候选方案的实测结论：
   - `node:sqlite`（内建，零依赖，但可能仍标 experimental）
   - `better-sqlite3`（原生模块，要按 Electron ABI 重建、要处理 vsix 打包与跨平台）
   - `sql.js`（WASM，无原生依赖，但整文件读写，多进程并发写要自己加锁）
   - 纯 JSON + 文件锁（兜底，规模小也能用）
3. **跨进程并发**：两个 IDE 进程同时打开同一个 db 文件时，WAL 模式 + `busy_timeout` 的实测行为——并发读、单写者、写冲突重试的边界。给出最小可复现脚本与结论。
4. **db 文件放哪**：`%APPDATA%\QoderCN\...`（IDE 级，多窗口天然共享，但属于宿主目录）vs 扩展 `globalStorage`（VS Code 概念上的正确位置，需确认多窗口是否指向同一路径）。
5. **升级/回滚**：db 文件版本号与向前兼容策略（宿主升级后 schema 迁移失败怎么办）。

## 完成标准

一份结论写进 `research/01-storage-engine.md`：推荐引擎 + 明确限制 + 验证脚本路径 + 一句「不选另外几个的原因」。这张票挡着 02 和 03，结论必须能直接支撑协调协议与 schema 的设计。

## Answer

**2026-11-10 定稿，证据与配置见 [research/01-storage-engine.md](../research/01-storage-engine.md)。**

- **用宿主内建的 `node:sqlite`**。实测 QoderCN 的 Electron 42.11.18 内嵌 Node **24.19.0**（ABI 146），`require('node:sqlite')` 无需任何 flag 即可用，无 ExperimentalWarning。零依赖、零原生编译、vsix 不背二进制。
- **db 放 `context.globalStorageUri`**（`%APPDATA%\QoderCN\User\globalStorage\<publisher>.<ext>\facts.sqlite`）：同一台机器所有窗口同一路径，这是“多开共享”的物理基础。
- **PRAGMA**：`journal_mode=WAL` + `synchronous=NORMAL` + `busy_timeout=300` + `user_version`。
- **三条硬约束（要写进 02/03 的设计）**：
  1. `DatabaseSync` 同步 API 会阻塞整个扩展宿主：单次事务要小（实测 500 行/事务 1ms，安全线 ~10ms）、禁止无界查询、回填要分批。
  2. `busy_timeout` 必须小（300ms）：等待是阻塞式的，设大就是“锁冲突时界面卡 N 秒”。
  3. `node:sqlite` 仍标 experimental：包一层适配器 + 启动 feature-detect，失败降级到 JSON + 文件锁（仅单实例）。
- **降级与未验**：漫游/网络盘上 `-shm` 可能不可用（启动试 WAL，失败退 `journal_mode=DELETE`）；`-wal` 定期 `ckpt(TRUNCATE)`（在 03 定频率）；`CREATE TABLE IF NOT EXISTS` + `user_version` 做幂等迁移。
- **没选**：`better-sqlite3`（原生 ABI 重建 + 升级易失配）、`sql.js`（整文件读写、无跨进程锁）、纯 JSON（仅作兜底）。
