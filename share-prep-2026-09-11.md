# 分享准备提纲 — Qoder & AI 实践经验

**时间**：2026-09-11（周五）14:00 - 15:00
**形式**：Live Demo，无 Slides
**听众**：软件工程师，有 Qoder 使用经验

---

## 开场（14:00 - 14:02，2 min）

> "今天分享三个主题：Scrum Buddy 新功能、团队协作配置框架 qoder-team-config、EDS QML 组件库 eds-book-gitlab。各自独立，但实际工作中交叉使用。"

---

## 板块 1：Scrum Buddy 新功能（14:02 - 14:10，8 min）

### 1.1 ALM 集成（~4 min）

**讲述要点**：Scrum Buddy 的 ALM 模块提供 26 个 MCP 工具，覆盖缺陷/测试/需求/发布全生命周期。

**Demo 操作**：
```
# 方式一：直接获取缺陷详情（推荐，稳定）
/alm_get_defect  defectId: <选一个你熟悉的缺陷ID>  domain: ULTRASOUND  project: Wuxi

# 方式二：搜索缺陷（⚠️ 当前 alm_search_defects 返回 500，分享前需再试一次）
/alm_search_defects  query: "status[=]Open"  domain: ULTRASOUND  project: Wuxi
```

**关键信息**：
- ALM 服务器：`https://alm16.apps.ge-healthcare.net`
- 域：`ULTRASOUND`，项目：`Wuxi`
- 缺陷 ID 1 示例：`NO China ROHS label, haven't got China registration for Ayan R2`（2002年的老缺陷，建议选近期的）

**对比展示**：打开 ALM 网页 vs 在 Qoder 中用自然语言查询，速度差异一目了然。

### 1.2 日常工作流（~4 min）

**讲述要点**：快速过一下 7 大平台集成，重点展示日常怎么用。

**要点列表**：
| 平台 | 日常用途 |
|------|---------|
| Jira | Sprint 管理、Issue 跟踪 |
| Confluence | Sprint Review 报告自动生成 |
| GitLab | MR 查看、Diff 分析 |
| Rally | 工作项查询 |
| Figma | 设计稿抓取（后面 eds-book 部分详细演示） |
| Outlook | 会议室查询、日程管理 |
| ALM | 缺陷/测试管理（刚才已演示） |

**Demo 建议**：如果有时间，展示一次 Sprint Review 自动生成（Jira → Confluence）。

---

## 板块 2：qoder-team-config 团队协作框架（14:10 - 14:30，20 min）

### 2.1 Rules / Skills 统一（~4 min）

**讲述要点**：一个中央仓库，统一维护团队的编码规则和 AI 技能，通过符号链接分发到各产品线。

**Demo 操作**：
1. 切到 `e:\AIGen\qoder-team-config\` 目录
2. 展示目录结构：
   ```
   qoder-team-config/
   ├── rules/                    # 编码规则
   │   ├── git-conventions.md    # always-on
   │   ├── review-checklist.md   # always-on
   │   ├── language-convention.md
   │   └── model-decision/       # 按需加载
   │       ├── cpp-coding-standards.md
   │       ├── naming-conventions.md
   │       ├── qml-coding-standards.md
   │       └── testing-standard.md
   ├── skills/                   # AI 技能
   │   ├── registry              # ← 展示这个文件
   │   ├── capture-session/
   │   ├── distill-findings/
   │   ├── qt-qml/
   │   └── ... (9个技能)
   ├── knowledge/                # 团队知识库
   │   ├── architecture/         # 75+ 架构文档
   │   ├── lessons/
   │   ├── practice/
   │   └── reference/
   ├── findings/                 # 原始发现（append-only）
   └── harness/                  # AGENTS.md
   ```
3. 打开 `skills/registry` 文件 — 展示技能到产品的映射：
   ```
   capture-session: all
   qt-qml: Gemini, Nexus
   qt-qml-review: Gemini, Nexus
   ```
4. 提一下 `scripts/qowork.bat` 一键部署机制（符号链接到各产品线）

### 2.2 Harness / AGENTS.md 设计（~4 min）

**讲述要点**：解决 AI 在大项目中的"上下文迷失"问题——AI 不知道该看哪些文件、遵循什么规则。

**Demo 操作**：
1. 打开 `harness/Nexus/AGENTS.md`（43行，简洁有力）
2. 讲解结构：
   - **Prerequisites**：确保 .qoder/ 已部署
   - **Rules**：always-on + model-decision 分层
   - **Architecture Documentation**：索引到 75+ 架构文档
   - **Design Documentation**：per-feature 设计目录
3. 强调设计理念：**只索引不复制，轻量导航**
4. 提到 `design/` 目录：AI 生成的设计文档按 feature branch 组织

### 2.3 知识捕获闭环（~10 min）⭐ 重点

**讲述要点**：这是让 AI "越用越聪明"的关键——三层漏斗 `findings/ → knowledge/ → rules/`

**Demo 步骤**：

**Step 1：展示 findings（原始数据）**
- 打开 `findings/2026/09/2026-09-07-yugang.yan.jsonl`
- 解读一条真实 finding：
  ```
  QML Popup 的 mapToItem(Overlay.overlay) 在组件创建时 Overlay.overlay 还是 null，
  必须在 onOpened 信号中做坐标映射
  ```
- 说明这是 capture-session 自动从编码会话中提取的

**Step 2：讲解 capture-session 流程**
- Phase 1（静默收集）：编码过程中自动检测知识信号
  - 🔴 强制记录：编码后出错的情况（不可删除）
  - 普通信号：踩坑、惊喜、workaround、隐藏 bug
- Phase 2（子代理分析）：spawn 子代理合并 git diff + 会话信号
- Phase 3（开发者确认）：展示确认界面，可编辑/删除/保留
- Phase 4（写入 findings）：追加到 JSONL 文件

**Step 3：讲解 distill-findings（蒸馏）**
- 定期由维护者运行 `/distill-findings`
- 原始 findings → 去重、分组、统计 → 蒸馏为 knowledge/lessons/、knowledge/practice/
- 高频问题（≥3次出现）→ 建议提升到 rules/
- 展示 `knowledge/lessons/qt6-qml-color-and-graphical-effects.md` 作为蒸馏产出示例

**Step 4：（可选）现场跑 capture-session**
- 如果在分享过程中做过代码修改，可以现场触发
- 否则展示之前的 findings 数据即可

---

## 板块 3：eds-book-gitlab EDS QML 组件库（14:30 - 14:53，23 min）

### 3.1 项目介绍（~4 min）

**讲述要点**：GE HealthCare 临床应用的 Qt Quick/QML 企业设计系统（EDS 2.0）。

**关键数据**：
- 57 个 QML 组件（Button、Modal、DataGrid、TreeNav 等）
- 2,800+ SVG 图标（3种尺寸，运行时着色）
- 352 个暗色主题设计令牌

**Demo 操作**：
1. 运行 `e:\AIGen\eds-book-gitlab\demo-app\build\eds-gallery.exe`
2. 浏览 Gallery 中的几个亮点组件
3. 展示图标系统的搜索/着色功能

### 3.2 Figma 抓取 Token（~4 min）

**讲述要点**：设计令牌如何从 Figma 进入代码。

**Demo 操作**：
1. 展示工具链流程：
   ```
   Figma → figma_extract_tokens → design-tokens.json → EdsTheme.qml
   ```
2. 打开 `lib/EDS/EdsTheme.qml`，展示 352 个令牌定义
3. 打开 `tokens/screen-tokens/` 目录，展示 6 个页面级令牌文件

### 3.3 现场 Figma 抓取 Demo（~8 min）⭐ 高光

**讲述要点**：现场演示从 Figma 设计稿抓取组件信息。

**Demo 操作**：
1. 使用 Scrum Buddy 的 Figma MCP 工具：
   ```
   /figma_get_file  fileKey: <需要提前确认 Figma 文件 key>
   /figma_get_layout  fileKey: <key>  nodeId: <node>
   /figma_get_code  fileKey: <key>  nodeId: <node>
   ```
2. 展示抓取结果：布局结构、设计令牌映射
3. 和已有的 QML 组件做对比

> ⚠️ **重要**：分享前需确认 Figma 文件的 fileKey！
> 项目中已有缓存数据在 `figma-tools/tmp/12363-15996-raw.json`（node ID: 12363:15996），
> 但 fileKey 需要从 Figma URL 中获取。

### 3.4 已有成果展示（~5 min）

**讲述要点**：展示 AI 自动生成的临床界面，对比 Figma 设计和 QML 实现。

**Demo 操作**：
1. 展示已生成的 6 个屏幕页面：
   - `screens/TgcCard.qml` — TGC 增益控制卡片
   - `screens/CardSelector.qml` — 卡片选择器
   - `screens/tpBonusAreaConfig.qml` — 触控面板 Bonus 区域配置
   - `screens/PresetsCard.qml` — 预设卡片
   - `screens/UdkCard.qml` — UDK 卡片
   - `screens/tpBonusAreaSelector.qml` — Bonus 区域选择器

2. 对比展示：Figma 设计稿截图 vs QML 渲染效果

3. 总结：
   > "这套工具链让 UI 开发从'手动翻译 Figma'变成'AI 自动生成 + 人工微调'"

---

## Q&A / 自由讨论（14:53 - 15:00，7 min）

- 开放提问
- 如果时间富余，可以现场让大家试 `qowork.bat` 部署

---

## 准备 Checklist

| 项目 | 状态 | 备注 |
|------|------|------|
| Scrum Buddy MCP 连接 | ✅ 已验证 | ALM get_defect 正常；search 返回 500 需再试 |
| eds-gallery.exe | ✅ 已构建 | `eds-book-gitlab\demo-app\build\eds-gallery.exe` |
| capture-session 技能 | ✅ 可用 | 完整的 4 阶段流程 |
| distill-findings 技能 | ✅ 可用 | 有真实 findings 数据（8 个文件） |
| findings 真实数据 | ✅ 丰富 | 最近的：2026-09-07，QML Popup 坐标映射等 |
| AGENTS.md 示例 | ✅ Nexus | 43 行，清晰展示 harness 结构 |
| skills/registry | ✅ | 9 个技能的产品映射表 |
| Figma fileKey | ⚠️ 需确认 | 请提前确认 Figma 文件 URL |
| ALM 缺陷 ID | ⚠️ 需选择 | search 接口 500，建议用 get_defect + 已知 ID |
| Backup 截图 | ❌ 未准备 | 建议提前截取 Gallery + findings 界面 |

### ⚠️ 分享前必做

1. **确认 Figma 文件**：打开你要演示的 Figma 文件，从 URL 中复制 fileKey
2. **测试 ALM search**：分享前 30 分钟再试一次 `alm_search_defects`，如果仍然 500 就用 `alm_get_defect` + 指定 ID
3. **启动 eds-gallery.exe**：提前打开，避免现场等待加载
4. **准备好 Qoder 工作区**：打开 qoder-team-config 项目，确保文件树可见
