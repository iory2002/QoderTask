# 04 结论：approve 时间戳能直接拿；取数窗口只剩 20 条余量

探针：`probe-gitlab-timestamps.js`，原始输出 `probe-gitlab-timestamps.out.txt`。

## 1. 最重要的好消息：`/approvals` 自带时间戳

```
!3786 [merged] approved_by=1  sample keys = user,approved_at
!3691 [merged] approved_by=1  sample keys = user,approved_at
```

- **approve 时间直接来自 `/approvals`**，不需要去解析 `/notes` 的 system note
- **MR 合并后审批记录仍然保留**（两个已合入的 MR 都还能读到），所以历史可以回填
- 03 里 `mr_approval.approved_at` 这一列可以落实，不必留 NULL

## 2. 指标 → 字段对照

| 指标 | 需要的字段 | 实际能不能拿到 |
|---|---|---|
| 前置时间 | 首次提交 → `merged_at` | `created_at` / `merged_at` 有；「首次提交」用 `/commits` 的 `authored_date` 最早值（准确但多一次请求），建议**第一版用 `created_at`**，简单且稳定 |
| 评审等待 | `created_at` → 首个 `approved_at` | ✅ 直接可算 |
| 构建成功率 | `build.result` 分布 | ✅ 已有 |
| 评审往返次数 | notes 里的 `requested changes` / `unapproved` | ❌ 实测 11 条 notes 只有 1 条审批相关、0 条 requested changes（本环境走 approval，不走 request-changes 流程）→ **不做** |
| 部署频率 | `merged_at` 按天聚合 | ✅ |

## 3. 坑 1：时区必须按 epoch 解析，不能字符串截断

```
!3786 commits=1 最早=2026-11-09 20:55   ← 而它 merged = 2026-11-09 13:00
```

差 8 小时正好是 `+08:00` 与 UTC 的偏移。任何"截前 16 个字符比较"的写法都会得出"提交时间晚于合入时间"这种荒谬结论。**所有时间在入库时 `Date.parse()` 成 ms**（03 的 DDL 也是 INTEGER）。

## 4. 坑 2：取数窗口只剩 20 条余量

```
窗口[all]    90 天内 total=280  pages=3
窗口[merged] 90 天内 total=259  pages=3
```

现有实现是 `per_page=100` 最多翻 **3 页 = 300 条**，而真实数据已经 280 条。再涨 20 条，超出部分静默丢失 → 那些已合入的 MR 找不到 → 卡片的阶段会从「已合入」退回「未提交」。这不是理论风险，是差 20 条就发生的事。

**必须改成翻到空页为止**（保底上限 10 页 = 1000 条），并把"是否被截断"记进日志/notice，截断时明确告警而不是假装完整。

## 5. 其它

- **限流**：响应里没有 `ratelimit-*` / `retry-after` 头，说明没有明确的配额通告。保持现有并发 4 + 失败退避即可，不做额外限速。
- **`resource_state_events`**：open 的 MR 返回 0 条，拿不到状态流转历史，不用它。
- **`draft` / `has_conflicts` / `blocking_discussions_resolved`**：列表接口直接返回，已在 08 用过。

## 6. 对 05（指标）的输入

- 可以做：前置时间（`created_at` → `merged_at`）、评审等待（`created_at` → 首个 `approved_at`）、构建成功率与时长、每日合入数
- 不能做：评审往返次数
- 前提：窗口必须扩到"翻到空页"，否则指标的分母会悄悄变小
