/**
 * 把 webview/ 下的 Preact 应用打包成 media/*.js。
 *
 * 产物必须落在 media/ 并以 asWebviewUri 加载：脚本一旦内联进 HTML 模板字符串，
 * 反斜杠会被吞掉（曾把 /\s+/g 变成 /s+/g）。
 *
 * 两个入口（Jira 看板 / MR 看板）共用同一份构建配置，各自产出独立 bundle：
 * WebView 的 CSP 按 bundle 放行，混在一起会让一块看板的错误拖垮另一块。
 */
const path = require('path');
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const options = {
    entryPoints: [path.join(__dirname, 'webview', 'board.tsx'), path.join(__dirname, 'webview', 'mr-board.tsx')],
    outdir: path.join(__dirname, 'media'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome100'],
    jsx: 'automatic',
    jsxImportSource: 'preact',
    minify: !watch,
    sourcemap: false,
    logLevel: 'info',
    define: { 'process.env.NODE_ENV': '"production"' },
};

async function main() {
    if (watch) {
        const ctx = await esbuild.context(options);
        await ctx.watch();
        console.log('[build-webview] watching webview/ -> media/board.js, media/mr-board.js');
        return;
    }
    await esbuild.build(options);
}

main().catch((err) => {
    console.error('[build-webview] failed:', err);
    process.exit(1);
});
