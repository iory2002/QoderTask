# 卡片信息架构与排序规则

Type: grilling
Status: resolved

## Question

一张卡上到底放什么、按什么顺序放、排不动的时候按什么排？

前提（已锁定，不用重开）：只有「拖拽跨列」一个手势，同列内不排序，所以卡片的顺序必须由服务端事实推导——是 Jira rank（`Rank` 字段，需确认是否可取），还是 `updated` 倒序，还是按 key 字典序？三者对「我该先干哪张」的可用性差别很大。

需要定的：

- 卡的常驻信息：key、标题截断规则、issue type、priority、阶段徽章、MR 图标、build 号、是否显示 assignee（按 assignee 分泳道时是冗余信息）。
- 阶段徽章与 Jira 状态徽章是否同时出现在卡上，还是两者合并成一个（卡片已经落在状态列里，状态徽章可能冗余）。
- 点击卡片的去向：打开浏览器、打开详情侧栏、还是什么都不发生（拖拽是唯一交互）。
- Done 列的卡片如何降噪（虚化 / 折叠 / 显示最后 N 张）。
- 「只看我的」过滤开启后，泳道行怎么变（空泳道隐藏还是保留占位）。

## 交付

卡片的字段清单与优先级、排序规则及其依据。它是分阶段落地票的前置。

## 已知事实

**排序已定**：`ORDER BY Rank ASC`（`customfield_10005`，LexoRank 字符串可直接比较），卡片天然有序，不需要本地排序。

**没有泳道**：整个 sprint 在每个列内是一条纵向卡片流，不分行。

**真实卡片的解剖结构**（来自用户在 Jira 上的实际截图）：

```
[类型/状态图标] NEX2-777                        [assignee 头像]
[优先级箭头] Redesign Static 3D TP page
            layout with Routine button,
            render cards, Edit Light, and
            [OB-Workflow 橙色 chip]            [💬 3]
```

即：左上图标 + key、优先级箭头、三行内的标题、右上 assignee 头像、一个橙色 chip、右下带数字的评论/附件徽标。

**橙色 chip 已定位**：截图里带 chip 的 NEX2-777 / NEX2-783 的 `Epic Link` 都是 `NEX2-775`，其标题为「OB GYN Workflow」——所以那个 `OB-Workflow` chip 是 **Epic 标签**，不是 component。

**可选字段已核实**：`Epic Link=customfield_10000`、`Rank=customfield_10005`、`Sprint=customfield_10004`，一次 search 可批量取回。

## Answer

**常驻字段与优先级**（从上到下）：

1. 类型图标 + key（链接到 Jira）
2. 标题，截 3 行
3. 优先级箭头 + `Epic` chip（仅当有 epic）+ 评论/附件计数
4. **阶段徽章**（与列不重复：列 = Jira 状态，徽章 = 交付阶段）
5. assignee 头像：**仅在「只看我的」关闭时显示**（开启时全员都是自己，属冗余）

**排序**：服务端 `Rank ASC`，本地不排序。

**Done 列**：全量展示但灰化降噪，不折叠、不截断。

**点击卡片**：开右侧详情浮层，内容：

- 阶段事实链：MR 号与链接、state、approver、`merged_at`；构建号、构建绝对时间、构建分支（因为构建滞后半天到一天，时间必须可见）
- 当前阶段的推导说明（命中哪条规则）
- 「推送 In Test」按钮（走软闸门）
- 「在 Jira 中打开」

**密度**：卡宽 288px、标题 3 行；<900px 横向滚动而非堆叠。
