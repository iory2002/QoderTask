# 04 GitLab 通道实测：关联规则被推翻，NEX 链路已确认

探针：`research/probe-nex-mapping.js`、`probe-gitlab-project.js`、`probe-gitlab-mrs.js`（只读可重跑）。

## 1. 仓库定位

| 项 | 值 |
|---|---|
| GitLab | `https://gitlab.apps.ge-healthcare.net`（自签证书，需 `rejectUnauthorized:false`） |
| 仓库 | `ultrasoundgeneralimaging/gipc-app`，**id = 90878** |
| 配置里的 `gitlab.defaultProjectId` | **105706 → 404，已失效**。改用路径或 90878 |
| 分支 | `nexus/dev/7.10.x` ✓、`nexus/dev/5.10.x` ✓、`nexus/maint/5.10.x` ✓、`main` ✓ |

## 2. NEX 链路确认（用户假设成立）

```
NEX  →  GitLab: ultrasoundgeneralimaging/gipc-app @ target nexus/dev/5.10.x
     →  Jenkins: UltrasoundGeneralImaging/ultrasoundgeneralimaging%2Fgipc-app/nexus%2Fdev%2F5.10.x
```

Jenkins 该分支最近构建：`#443 SUCCESS 2026-11-06 04:07`（1176 min）、`#442 SUCCESS 2026-11-02`（688 min）。与 7.10.x 同仓库、同 job 模式，只换分支层。

## 3. 关联信号：分支名不可靠，标题才是主信号

实测 12 个合并到 `nexus/dev/7.10.x` 的 MR：

| MR | source_branch | 标题里的 key | 分支里的 key |
|---|---|---|---|
| !3742 | `bug-891` | `NEX2-891` | ✗ |
| !3769 | `task-932` | `NEX2-932` | ✗ |
| !3698 | `bug-fix-on-spot` | `NEX2-950` | ✗ |
| !3700 | `story-933` | `NEX2-933` | ✗ |
| !3703 | `story-NEX2-805` | `NEX2-805` | ✓ |
| !3720 | `story-932` | `NEX2-932` | ✗ |
| !3749 | `story-NEX2-1038-1039` | `NEX2-1038` | ✓ |
| !3741 | `bug-837` | `NEX2-837` | ✗ |
| !3697 | `bug-760` | `NEX2-760` | ✗ |
| !3753 | `task-bfapc` | **无** | ✗ |

→ **分支名大多只有裸编号**（`bug-891`、`task-932`），拿不到项目前缀。**标题才是主信号**；描述里有时也有，可作第三顺位。

5.10.x 侧同样规律：`story-2591` / `task-Nexus-IQ` 等裸名，key 在标题（`NEX-2591`）。

## 4. 通用 key 正则会误报

样本里出现了 `SPRS<00000>`、`SPRS<100869, 100888>`、`C1-6`、`L3-12`、`ML6-15`。

`/\b([A-Z][A-Z0-9]{1,9}-\d+)\b/` 会把这些当成 Jira key。**必须用项目白名单**：

```js
/\b(NEX2|MAGR3|NEX|IB)-\d+\b/g     // 注意长 key 排前面，NEX2 先于 NEX
```

## 5. 审批信号：`approved_by` 不在列表接口，且「有人批」≠「已批准」

### 5.1 字段在哪

| 端点 | `approved_by` |
|---|---|
| `GET /projects/:id/merge_requests`（列表） | **字段不存在**（不是空数组，是完全没这个 key） |
| `GET /projects/:id/merge_requests/:iid`（详情） | **字段不存在** |
| `GET /projects/:id/merge_requests/:iid/approvals` | 有：`approved_by[]`、`approved`、`approvals_required`、`approvals_left` |

所以之前说的「merge 后审批被清空」是**错的**：已合并的 !3773 在 `/approvals` 里明确有 `approved_by: ["Schlunk, Siegfried"]`、`approved: true`。只是列表/详情接口从不返回这个字段。

### 5.2 有人批 ≠ 已批准

`!3636`：`approved_by` 有 1 人，但 `approved = false`、`approvals_left = 1`、`detailed_merge_status = not_approved`。可能是新提交使审批失效，或该人不在审批规则内。

→ **判据必须是 `approved === true`（等价 `approvals_left === 0`），不能用 `approved_by.length > 0`。**

### 5.3 `detailed_merge_status` 不能当审批判据

- `state=merged` 的 MR 统一是 `not_open`，对阶段无信息量；
- `opened` 的值是复合语义（`not_approved` / `draft_status` / `requested_changes` / 可能还有 `ci_still_running` 等），把非 `not_approved` 当成「已批准」会在 CI 未完成时误判。
- 历史包袱：旧 `GitLabService` 就是因为错误使用 `detailed_merge_status` 而把 MR 错误过滤掉。

### 5.4 推荐的请求形状

1. 每轮 1 次列表请求（`target_branch` + `updated_after`）拿到全部 MR；
2. 仅对 **`state = opened` 的 MR** 补 1 次 `/approvals`（数量少，且有并发上限）；
3. `state = merged` 的直接按「已合入」处理，不查审批。

这不是「按卡片逐个查」——卡片数（110）远大于 opened MR 数（个位数），且同一 MR 可能服务多张卡。

## 6. 一个 issue 多个 MR 是常态

`NEX2-932` 同时挂着三个 MR：

| MR | source_branch | merged_at |
|---|---|---|
| !3720 | `story-932` | 2026-11-03 10:19 |
| !3760 | `task-932` | 2026-11-05 11:17 |
| !3769 | `task-932` | 2026-11-06 08:48 |

规则：**取阶段最高者；同阶段取 `merged_at` 最新者**（此例为 !3769）作为卡片展示的那一个；详情浮层列出全部，便于回看。

## 6b. 一个 MR 也可能覆盖多个 issue

`!3749` 标题是 `NEX2-1038+1039`，一个 MR 同时交付两个 issue。

白名单正则只会抓到 `NEX2-1038`，`+1039` 因为没有项目前缀而漏掉。**需要「前缀继承」规则**：当 key 后面跟着 `+NNN` 或 `, NNN` 时，用前一个 key 的项目前缀补齐。否则 NEX2-1039 会被误判成「未提交」。

## 7. 无 key 的 MR

`!3753`（`task-bfapc`，标题无 key）——这类 MR 不归属任何 issue，本就不该影响任何卡片。关联失败即忽略，不报错。