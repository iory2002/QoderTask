# 06: 详情浮层（只读）

**What to build:** 点一张卡片，右侧滑出它的交付事实：命中哪个 MR、谁批的、什么时候合的、这个徽章是按哪条规则算出来的。徽章从此有出处，误判能自己看穿。

**Blocked by:** 05

**Status:** resolved

- [x] 点卡片打开浮层，Esc 或点空白处关闭
- [x] 浮层显示关联 MR 的编号、状态、批准人、合入时间，以及「是靠标题还是靠分支名关联上的」
- [x] 浮层说明当前阶段的推导依据（命中了哪一条判定规则）
- [x] 同一个 issue 有多个 MR 时全部列出，默认高亮卡片上展示的那个
- [x] 有关联不到 MR / 数据缺失的情况，浮层明确写出「为什么无法判定」
- [x] 「在 Jira 中打开」用外部浏览器打开，不在 IDE 内跳转
- [x] 浮层内容随轮询更新，但不会在用户读的时候把焦点抢走

## Comments

- 详情**不走消息往返**：`board:state` 里已经带了 `mrs[]`（全部 MR，含 `matchedBy`）与 `evidence[]`（人话版推导依据），浮层直接从当前 state 里按 key 取卡片。这样轮询一更新浮层内容就跟着变，也不会出现第二份真相。原协议里的 `card:openDetail` 因此删掉（保留它只会是死代码）。
- 高亮规则：`MrFact.isCardMr`，由 `applyResult()` 按 `resolveStage()` 选出的那一个打标；其余 MR 用普通卡片展示。
- 「为什么无法判定」的三种形态分别写清楚：项目无 repo 条目（不追踪）、取数失败（unknown）、关联不到 MR（未提交）。
- 审批人只对 `opened` 的 MR 展示，`merged` 的 MR 明确写「未查（只对 opened 的 MR 查审批）」——避免让人以为没审批记录。
- 不抢焦点：浮层只在打开时读一次 `selectedKey`，之后按 key 从 state 里取新数据；不 autofocus、不滚动、不重设选中。
- 「在 Jira 中打开」走 `card:openJira` → `vscode.env.openExternal`；MR / 构建链接走 `board:openExternal`，同样只允许 http(s)。
- **MR 打开入口补强**（用户反馈："在 Jira 中打开不够"）：原实现只在 MR 列表里把 `!3720` 做成小链接，不像个功能。现在：
  - 浮层底部在「在 Jira 中打开」**之前**加显式按钮「打开 GitLab MR !n」，指向卡片上展示的那个 MR（`isCardMr`，无则取第一个）；多 MR 时文案带「（另有 N 个）」。
  - MR 列表里的 `!iid` 改成 `!iid ↗` 并补 `title`，看得出是可点的外部链接。
  - 仍然全部走 `board:openExternal`，不在 IDE 内跳转。
- 0.3.1 打包验证：`todo-panel-0.3.1.vsix`（31 files / 72.11 KB），`media/board.js` 33.68 KB。
