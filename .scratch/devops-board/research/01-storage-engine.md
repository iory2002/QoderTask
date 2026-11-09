# 01 结论：用宿主内建的 `node:sqlite`，零依赖、同步 API 够快

探针：`probe-sqlite-concurrency.js`（会写仓库内 `tmp-probe.sqlite`，跑完自删）。原始输出：`probe-sqlite-concurrency.out.txt`。

## 1. 运行时事实

用宿主自己的可执行文件当 Node 跑（`ELECTRON_RUN_AS_NODE=1`），与扩展宿主同版本：

```
node=24.19.0  electron=42.11.18  abi=146
node:sqlite OK  exports=DatabaseSync,StatementSync,Session,constants,backup
```

- **不需要 `--experimental-sqlite`**，也不需要额外 flag，`require('node:sqlite')` 直接可用
- 没有出现 ExperimentalWarning（stderr 干净）
- 这意味着**零依赖、零原生编译、零打包体积**——vsix 里不用带 `.node` 二进制

## 2. 跨进程并发（两个独立进程，同一个 db 文件）

```
bench: 500 rows in one txn = 1ms；50 rows autocommit = 0ms；COUNT(*) = 550 in 0ms
leader: write lock held at +0ms, sleeping 3000ms
leader: committed at +3021ms
follower: read OK at +0ms value=null        ← WAL 下读不被写锁挡
follower: write OK after 2120ms             ← 等锁 ~2s 后成功
```

结论：

- **WAL 生效**：写者持锁期间，另一个进程的读**立刻成功**（读到的是快照，`value=null` 是尚未提交，不是失败）
- **写者互斥**：第二个写者阻塞到 `busy_timeout`，锁释放后成功；超时则抛 `SQLITE_BUSY`
- **同步 API 很快**：500 行一个事务只要 **1ms**，单行 autocommit 亚毫秒。也就是说在扩展宿主线程上直接跑这些小事务，不会造成可感知的卡顿

## 3. 推荐配置

```ts
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode=WAL');
db.exec('PRAGMA synchronous=NORMAL');   // WAL 下够用，写入快一个量级
db.exec('PRAGMA busy_timeout=300');     // 见风险 2：不能设大
db.exec('PRAGMA user_version=1');       // 迁移版本号
```

db 文件放 **`context.globalStorageUri`**（`%APPDATA%\QoderCN\User\globalStorage\your-name.todo-panel\facts.sqlite`）。已确认该目录存在且按用户共享——**同一台机器上的多个 IDE 窗口指向同一路径**，这正是"共享一个事实库"的物理基础（协调协议见 02）。

## 4. 三个必须写进设计的限制

1. **`DatabaseSync` 是同步 API，没有异步版本**。它会阻塞整个扩展宿主线程（所有扩展一起卡）。所以：单次事务必须小（实测 500 行 1ms，安全线约 1 万行 / 10ms）；禁止无界查询（`SELECT *` 全表）；回填历史时必须分批提交。
2. **`busy_timeout` 要小**（建议 300ms）。因为等待是**阻塞式**的：设成 2s，就意味着"锁冲突时界面卡 2 秒"。宁可快速失败 + 重试，也不要长阻塞。
3. **`node:sqlite` 在 Node 文档里仍标注 experimental**。宿主升级 Electron（42 → 43）时 API 可能微调。对策：包一层薄适配器 + 启动时 feature-detect（`require('node:sqlite')` 失败 → 降级到 JSON + 文件锁，仅支持单实例模式）。

## 5. 没选另外三个的原因

| 方案 | 为什么不用 |
|---|---|
| `better-sqlite3` | 原生模块，要按 Electron ABI（当前 146）重建；每次宿主升级都可能失配；vsix 要背多平台二进制 |
| `sql.js`（WASM） | 内存数据库 + 整文件读写，没有跨进程锁——多开共享正好是它最弱的地方 |
| 纯 JSON + 文件锁 | 只作降级兜底：无索引、无事务、并发写要自己保证原子性；数据量一大就不行 |

## 6. 还没验证（留到 02/03 再定，不阻塞本票）

- **%APPDATA% 在漫游/网络盘**时 WAL 需要共享内存（`-shm`），部分网络文件系统不支持。对策：启动时试 WAL 失败就退回 `journal_mode=DELETE`（慢但可用）。
- 长时间不回写导致 `-wal` 变大：需要定期 `PRAGMA wal_checkpoint(TRUNCATE)`（在 03 的保留策略里定频率）。
- 多个窗口同时首次建表：用 `CREATE TABLE IF NOT EXISTS` + `user_version` 做幂等迁移。
