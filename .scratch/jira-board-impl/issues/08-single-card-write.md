# 08: 单卡写回 Jira

**What to build:** 拖下去之后弹出确认表单，字段已经按这张卡当前的值填好，一路确认就能把状态真的改到 Jira 里。遇到插件填不了的字段，就明确让你去 Jira 完成，而不是发一个注定失败的请求。

**Blocked by:** 07

**Status:** resolved

- [x] 表单字段来自这张卡当前可用的动作，值按 issue 现有字段预填（不改就无需填写）
- [x] 只提交用户改动过的字段，未改动的不进请求
- [x] 支持单行/多行文本、单选、多选、人员四类控件
- [x] 遇到插件不支持的字段类型时，列出字段名、禁用提交、并给出「在 Jira 中完成」的链接
- [x] 必填项为空时提交按钮不可用
- [x] Jira 返回字段级错误时，错误显示在对应控件旁，不是笼统的「保存失败」
- [x] 写成功后卡片出现在目标列，浮层关闭，状态与 Jira 一致
- [x] 写失败时卡片不移动，错误原因可读

## Comments

- 表单在**拖拽开始时**就建好（`buildTransitionForm()`）：`GET /issue/{key}/transitions?expand=transitions.fields` 拿字段元数据，`GET /issue/{key}?fields=*all` 拿当前值。预填只能用后者——transitions 元数据里的 fields 不携带当前值。
- 控件映射：`string` → 单行（`description` 走多行）、`option/priority/issuetype/resolution` → 单选、`array(option|string|component|version)` → 多选、`user/assignee` → 人员；其余一律 `unsupported`，表单顶部列出并禁用提交。
- 只提交改动项：`collectChangedFields()` 逐字段比对预填值，相等的直接跳过；选项类按 `{id}`、多选按 `[{id}]`、人员按 `{name}` 回传。
- 写入用的是**最近一次拖拽**拿到的 transition（`lastInteraction`），提交时再按 id 校验一次；对不上就回「动作已经过期，请重新拖一次」，绝不拿过期动作硬发。
- 400 的 `errors` 是 `fieldId → 说明` 的结构，直接按 id 回填到对应控件下方；没有字段级错误才显示整体原因。
- 写入成功后本地立刻把卡片状态改成目标状态并重绘，随后触发一次真实刷新对齐 Jira。
- 8 条单测覆盖控件映射、预填、改动过滤、unsupported 不外泄、必填阻断。

## Superseded（2026-11-07）

放弃写回：Jira 的 transition 绝大多数带必填字段（screen），看板里无法可靠填写。本票交付的拖拽 / 表单 / 闸门代码已整体删除（含 dropRules / transitionForm / softGate 与对应单测），看板改为只读 + 深链。

