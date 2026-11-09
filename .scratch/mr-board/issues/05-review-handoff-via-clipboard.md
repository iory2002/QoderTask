# 05: 右键评审交接（Review Handoff）

**What to build:** 右键任意 MR 卡片都有固定菜单；对 `Reviewer 包含我` 的卡执行「用 Qoder 审查此 MR」时，扩展先把该 MR 的 diff 落成工作区里的本地文件，再把一条可直接发送的 `/code-review` 指令写进剪贴板并提示下一步。用户新建会话、粘贴、回车，评审就拿到确定的输入。

**Blocked by:** 04（详情浮层与 Jira key chip）

**Status:** implemented

- [ ] 所有卡片右键弹出菜单，三项固定顺序：`用 Qoder 审查此 MR`、`在 GitLab 中打开`、`复制链接`
- [ ] `用 Qoder 审查此 MR` 在 `我提交的` 列置灰不可用；`复制链接` 复制 MR web URL
- [ ] 执行审查时拉取其 diff（逐页，最多 3 页），覆盖写入工作区 `.scratch/mr-board/diffs/!<iid>.diff`，目录不存在则创建
- [ ] 剪贴板文本包含 `/code-review`、`!<iid>`、MR 链接、diff 的绝对路径，并明确「只审这个 MR 的改动，不要审当前工作区」
- [ ] diff 拉取失败时降级：剪贴板只含 `/code-review` 与 MR 链接，并指引用 `gitlab_get_mr_diff` 取 diff；同时在提示里说明降级原因
- [ ] 复制成功后弹提示，说明「打开 Qoder 聊天新会话（Ctrl+N）→ 粘贴 → 回车」
- [ ] 指令构造器的单元测试覆盖正常与降级两种文本
- [ ] `.scratch/mr-board/diffs/` 加入 `.gitignore`，避免审查痕迹污染 git status
- [ ] 不调用 `executeCommand` 去尝试打开聊天会话（见 ADR 0001：该命令是聊天 WebView 内部命令，不是 VS Code 命令）
- [ ] 详情浮层底部的「用 Qoder 审查此 MR」与右键走同一条路径，行为一致

## Comments

- 2026-11-07：自定义右键菜单（三项、第二列置灰）已落地；审查动作先拉 `/merge_requests/:iid/diffs` 写成 `.scratch/mr-board/diffs/!<iid>.diff`，再由 `buildReviewRequest` 生成指令写入剪贴板；拉取失败时降级为「只带链接 + 指引用 `gitlab_get_mr_diff`」。
- 绝不调用 `executeCommand('workbench.action.newChat')`（ADR 0001）；剪贴板路径在 Qoder 升级后仍然有效。
- 指令构造器两条单测覆盖正常 / 降级文本；`.scratch/mr-board/diffs/` 已加入 `.gitignore`。
- 待 IDE 内验收：右键菜单定位、剪贴板内容、提示文案。
