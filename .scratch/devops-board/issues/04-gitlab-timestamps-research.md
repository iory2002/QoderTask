# 04 GitLab 侧的时间戳到底能拿到哪些，取数窗口边界在哪

Type: research
Status: resolved
Blocked by: —

## Question

指标（尤其"评审等待"）能不能成立，全看 GitLab 给不给时间戳。要实测确认：

1. **MR 上的时间戳**：`created_at`、`updated_at`、`merged_at`、`closed_at`，以及首次提交/首个 commit 的时间（要不要另查 `/commits`）。
2. **approve 的时间**：`GET /projects/:id/merge_requests/:iid/approvals` 返回的 `approved_by` 有没有时间？没有的话，`/notes` 里的 system note（`approved this merge request`）是否带 `created_at`、能否稳定解析、分页能不能覆盖全部（100/页）。有没有 `resource_state_events` 之类更直接的接口。
3. **轮次与返工**：能不能从 notes 数出"被要求改动"的轮次（`requested changes` / `unapproved` 事件），这是"评审往返"指标的原料。
4. **窗口边界**：`/merge_requests?updated_after=90 天&per_page=100&page≤3` 的现实覆盖率——拿真实仓库统计 90 天内 MR 总数，确认 3 页 300 条够不够；不够的话改用 `created_after` 分页还是按里程碑/迭代切。
5. **反向索引可用性**：`/repository/commits/:sha/statuses` 与 `/pipelines?sha=` 是否对每个被 Jenkins 构建的 SHA 都有回写（抽 10 个 SHA 验证），以及 status 的 `target_url` 是否稳定指向构建号。
6. **限流**：GitLab 侧是否有 rate limit（响应头），多窗口/回填时要不要退避。

## 完成标准

`research/04-gitlab-timestamps.md`：一张"指标 → 需要的字段 → 实际能拿到 → 走哪个接口"的对照表，明确哪些指标可做、哪些只能近似（并写明近似方式）。探针脚本保留。

## Answer

**2026-11-10 定稿，对照表与证据见 [research/04-gitlab-timestamps.md](../research/04-gitlab-timestamps.md)。**

- **approve 时间可直接拿到**：`/approvals` 的 `approved_by[]` 带 `approved_at`，且 **MR 合并后记录仍保留** → 历史可回填，03 的 `mr_approval.approved_at` 不必留 NULL。
- **可做的指标**：前置时间（`created_at` → `merged_at`）、评审等待（`created_at` → 首个 `approved_at`）、构建成功率与时长、每日合入数。
- **不能做的指标**：评审往返次数——本环境走 approval 而非 request-changes，notes 里 0 条相关 event。
- **坑 1（已写入实现要求）**：GitLab 时间带 `+08:00`，必须 `Date.parse()` 成 epoch ms；任何字符串截断比较会得出“提交晚于合入”。
- **坑 2（需在实现时修）**：90 天内已 280 条，而 `listTargetBranchMrs` 只翻 3 页（300 条）——**余量只剩 20 条**，超出的 MR 会静默丢失导致卡片阶段从“已合入”退回“未提交”。必须改成翻到空页为止（上限 10 页）并在截断时告警。
- **限流**：无 `ratelimit-*` 头，保持并发 4 + 退避即可。
- **`resource_state_events`**：open 的 MR 返回 0 条，不可用。
