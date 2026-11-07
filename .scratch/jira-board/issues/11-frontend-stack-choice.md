# 前端技术形态选型

Type: grilling
Status: resolved

## Question

01 号票已经解除封锁：引擎是标准 Chromium（Electron 42.2.0 / 约 Chromium 148），框架产物能跑，「不能假设是 V8」这条先验作废。现在可以真正做这个选择了。

选项与代价：

- **零依赖模块化 vanilla**：拆成 `board / dnd / form / poller` 几个 TS 模块，`tsc` 编译后仍拼 HTML。不新增构建链，但看板要自管状态与重绘，表单与弹窗会写得很啰嗦。
- **Preact + esbuild**：4KB 运行时，JSX 组件化，产物打成单个 `.js` 用 `asWebviewUri` 加载——顺带消灭模板字符串吞反斜杠这个坑。代价是新增一条 esbuild 构建与 `npm run package` 的串联。
- **React + esbuild**：生态最全（拖拽有 dnd-kit），但对一个看板来说体积偏大，且扩展里没有别的 React 消费方。
- **Svelte + Vite**：产物最小、无运行时，但 Vite 的 dev server 与 `webview.asWebviewUri` 的路径约定要先打通，工程量最大。

需要一并定的：

- **WebView 脚本的交付方式**：继续内联进模板字符串，还是改成独立 `.js` 资源文件（推荐后者，`asWebviewUri` + CSP nonce）。
- **构建链的落点**：`npm run compile` 是否要串上前端打包；打包失败的失败面（内网、离线安装）怎么处理。
- **组件粒度**：Column / Lane / Card / TransitionForm / GateDialog 是否各自独立组件，还是一个大 render 函数。

## 推荐

Preact + esbuild，脚本走独立 `.js` 文件。理由：组件化能承载「泳道 + 卡片 + 表单 + 弹窗」四类结构；体积小到不影响扩展启动；顺带根治反斜杠问题。

## 已知事实

见 [research/01-webview-engine-capability.md](../research/01-webview-engine-capability.md)。

## Answer

**Preact + esbuild，WebView 脚本走独立 `.js` + `asWebviewUri`。**

- 组件：`Board` / `Column` / `Card` / `DetailPanel` / `TransitionForm` / `GateDialog`。
- 构建：新增 `esbuild` 脚本，`npm run compile` = `tsc -p ./ && node build-webview.js`；产物入 `media/board.js`，不内联进模板字符串（根治反斜杠问题）。
- 拖拽：优先用原生 HTML5 drag events（现有侧边栏已验证可用）；不够再上 `dnd-kit` 的轻量替代。
- CSP：保留现有 nonce 机制，`script-src 'nonce-…'`，不放开 `unsafe-eval`。
- 失败面：前端打包失败不影响 `tsc` 产出的扩展主体，但 `npm run package` 必须在打包前检查 `media/board.js` 存在且非空，否则 vsix 会带着空看板发布。
