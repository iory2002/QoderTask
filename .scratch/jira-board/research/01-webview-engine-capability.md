# 01 结论：QoderCN WebView 引擎能力

结论：**标准 Chromium，没有引擎缺陷，可以用任何现代前端框架。**「不能假设是 V8」这条先验是错的，真正踩过的坑是模板字符串吞反斜杠。

## 实测事实

| 项 | 值 | 来源 |
|---|---|---|
| 产品 | QoderCN 1.25.1（Alibaba Cloud） | `QoderCN.exe` VersionInfo |
| 上游 | VS Code 1.106.3 分支 | `resources/app/product.json` |
| Electron | 42.2.0 | `resources/app/build-manifest.json` |
| Chromium | 约 148（Electron 40 = 144，41 = 146，44 = 152，线性外推） | Electron 版本映射 |
| 构建时间 | 2026-08-18 | build-manifest.json |
| 运行时 JS | Chromium 的 V8（非自研解释器） | 安装包内 `icudtl.dat` / `libEGL.dll` / `chrome_*_percent.pak` |

## `\s` 事件的真实病因（已复现，非推测）

WebView 的 HTML 是整段塞进 TypeScript 模板字符串的（`TodoWebviewProvider._getHtmlContent`）。模板字符串里 `\s` 是普通转义序列，反斜杠被吃掉，浏览器实际收到 `/s+/g`，于是 `"In Progress"` 被换成 `"in progre-"`。

复现脚本：`research/template-literal-evidence.js`

```
写法 A（模板串里直接写 \s）→ 浏览器收到 /s+/g → in progre-
写法 B（写成 \\s）          → 浏览器收到 /\s+/g → in-progress
```

现状佐证：`src/providers/TodoWebviewProvider.ts:745` 至今用 `.replace(/ /g, '-')` 绕开，正是这个误解留下的疤。

## 对设计的影响

1. **技术形态解禁**：React 18 / Preact / Svelte 的产物都能跑。VS Code 的 WebView 仍是 CSP 受限环境，内联脚本需要 nonce（现有代码已带 nonce 机制）。
2. **反斜杠是长期风险**：只要 JS 继续写在模板字符串里，任何 `\d` `\w` `\s` `.` 都会出同类事故。结论写成硬规则：**WebView 脚本与其塞进模板字符串，不如放独立 .js 资源用 `asWebviewUri` 加载**；确实要内联时必须双写反斜杠。
3. **CSS 类可用**：「CSS 类会因 retainContextWhenHidden 缓存而失效」这条也高度可疑，更可能是重设 `webview.html` 后旧 DOM 未替换、或编译产物未重新安装。倾向结论：类名正常可用，样式失效时先查 `out/` 是否重新编译、扩展是否重装。

## 仍未验证（需要真机 UI 才能定）

- 重设 `webview.html` 后旧 `<style>` 是否残留。
- 拖拽相关事件（`pointerdown` / HTML5 drag）在 WebView 内的实际行为——但现有侧边栏已实现拖拽排序，可作为「可用」的间接证据。
