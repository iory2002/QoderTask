# 03 结论：Jenkins 能读，但拿不到 commit，只能走时间窗

探针：`research/probe-jenkins*.js`（只读，可重跑）。

## 1. 目标 job 已定位

用户提供的 daily build：

```
https://ulsgi-bm.lab.ge-healthcare.net:8443/job/UltrasoundGeneralImaging/job/ultrasoundgeneralimaging%252Fgipc-app/job/nexus%252Fdev%252F7.10.x/243/
```

拆开就是 Jenkins 的三层路径，**每层都是一次 URL 编码**（job 名里含字面 `%2F`，所以路径里是 `%252F`）：

| 层 | 值 |
|---|---|
| OrganizationFolder | `UltrasoundGeneralImaging` |
| Repository job | `ultrasoundgeneralimaging/gipc-app` |
| Branch job | `nexus/dev/7.10.x` |
| 构建 | `#243` |

该仓库下共有 **109 个分支 job**，含 `main`、`nexus/dev/7.10.x`、`nexus/maint/5.10.x`、`horizon/dev/7.10.x` 等。

## 2. 认证与传输约束

- **自签证书**：Node 原生 `fetch` 直接 `fetch failed`，必须 `https` 模块 + `rejectUnauthorized: false`（与 `GitLabService` 一致）。
- Basic 认证，`username` + `token`（配置里已解密）。
- job 路径必须对每一段做 `encodeURIComponent`，否则含 `/` 的分支名会被拆成多层。

## 3. 拿不到 commit（决定性结论）

| 信号 | 实测结果 |
|---|---|
| `actions[].lastBuiltRevision.rev` | **无 rev 字段**，只有 `branch: [{name: "refs/remotes/origin/nexus/dev/7.10.x"}]` |
| `changeSet.items[]` | **0 条**，没有 commitId 也没有提交说明 |
| `GITLAB_COMMIT_ID` 参数 | 参数存在，但最近 8 次构建**全为空字符串** |

所以：

- **「merge_commit_sha 精确匹配」在本环境不可能实现**，原定的「SHA 优先 + 时间窗兜底」实际只有时间窗一条腿。
- 无法从构建反查 Jira key（changeSet 为空，拿不到 commit message）。

## 4. 构建节奏（时间窗的精度上限）

| 构建 | 结果 | 启动时间 | 耗时 |
|---|---|---|---|
| #246 | 进行中 | 11-07 04:07 | — |
| #245 | SUCCESS | 11-06 14:00 | 989 min（16.5h） |
| #244 | SUCCESS | 11-06 04:07 | 950 min（15.8h） |
| #243 | SUCCESS | 11-05 14:00 | 864 min（14.4h） |
| #242 | SUCCESS | 11-05 01:52 | 1174 min（19.6h） |
| #241 | SUCCESS | 11-04 14:00 | 292 min（4.9h） |
| #240 | SUCCESS | 11-04 06:00 | 370 min（6.2h） |

- 每天两次启动（04:07 与 14:00），单次 5～20 小时。
- 结论：**「已构建」这个阶段天然滞后半天到一天**。今天下午合入的代码，最快次日凌晨才开始构建，再等十几小时出结果。
- 「进行中」（`result = null`）必须单独处理，不能被当成失败。

## 5. 对设计的三条硬约束

1. **构建判定只能按时间窗**：取目标分支 job 上「时间晚于 `merged_at` 的最近一次 SUCCESS」。没有 SHA 可比。
2. **必须展示构建的绝对时间与分支**，否则用户会误以为「已构建」是刚刚的事——实际可能是 20 小时前、且没覆盖他的提交。
3. **阶段链的真实形态**：`已合入待构建` 会是常态，`已构建` 是迟到的确认。因此推送 In Test 的闸门不能卡在构建上（已按 09 号票定为「已合入即可推，构建未过时软闸门警告」）。

## 6. 配置形态

job 无法从 Jira 项目名推断（Jenkins 按产品线组织，仓库名是 `gipc-app`），必须显式映射：

```
todoPanel.repos = [
  { jiraProject: "NEX2", gitlabProject: "ultrasoundgeneralimaging/gipc-app",
    jenkinsJob: "UltrasoundGeneralImaging/ultrasoundgeneralimaging%2Fgipc-app/nexus%2Fdev%2F7.10.x",
    targetBranch: "nexus/dev/7.10.x" }
]
```

MAGR3 / NEX / IB 的条目待补——给出对应 job URL 即可照此填。
