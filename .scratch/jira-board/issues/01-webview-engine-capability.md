# QoderCN WebView 引擎能力边界

Type: research
Status: resolved

## Question

这个 WebView 到底是什么 JS 引擎，能承载多复杂的看板前端？技术形态（vanilla / Preact / Svelte）在结论出来前一律挂起。

需要测出并列表记录：

- **引擎身份**：是 Chromium/Electron，还是自研解释器？`navigator.userAgent`、`window.chrome`、`typeof Proxy`、`Error.prepareStackTrace` 特征。
- **语法支持**：可选链 `?.`、空值合并 `??`、`async/await`、generator、class 私有字段、`<script type="module">`、动态 `import()`、`eval` 与 `new Function`。
- **内置能力**：`Promise`、`Map/Set`、`WeakMap`、`structuredClone`、`fetch`、`Intl`、`Date.toLocaleString` 的本地化是否可用。
- **DOM/事件**：`pointerdown/pointermove`、HTML5 drag events、`ResizeObserver`、`IntersectionObserver`、`requestAnimationFrame`。
- **CSS 支持度**：grid、flex `gap`、自定义属性（`--x`）、`:has()`、`color-mix()`、`position: sticky`。
- **缓存行为**：`retainContextWhenHidden` 下重设 `webview.html` 后，旧 `<style>`/`<script>` 是否残留；已验证的 `\s` 误匹配是否仍存在。

## 交付

一张能力表 + 一句结论：「能否安全使用某框架产物」。结论直接决定技术形态，也决定徽章样式必须走内联样式这条约束是否仍然成立。

## Answer

结论见 [research/01-webview-engine-capability.md](../research/01-webview-engine-capability.md)。

一句话：**QoderCN 1.25.1 = VS Code 1.106.3 分支 + Electron 42.2.0 + 约 Chromium 148，标准 V8，没有引擎缺陷，任何现代前端框架的产物都能跑。**

三条连带结论：

1. 「WebView 引擎有缺陷、不能假设是 V8」这条先验作废。`\s` 的真因是模板字符串吞反斜杠，已用 `research/template-literal-evidence.js` 复现（`in progre-` 一字不差）。
2. 由此立一条硬规则：**WebView 脚本放独立 .js 用 `asWebviewUri` 加载，不要塞进模板字符串**；必须内联时双写反斜杠。
3. 「CSS 类会被缓存导致样式不生效」高度可疑，更可能是 `out/` 未重编译或扩展未重装；内联样式不再是硬约束。

仍未验证：重设 `webview.html` 后旧 `<style>` 是否残留。需要真机 UI 才能定，不阻塞设计。
