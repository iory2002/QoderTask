/**
 * 把 webview/ 下的 Preact 应用打包成 media/board.js。
 *
 * 产物必须落在 media/ 并以 asWebviewUri 加载：脚本一旦内联进 HTML 模板字符串，
 * 反斜杠会被吞掉（曾把 /\s+/g 变成 /s+/g）。
 */
const path = require('path');
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const options = {
    entryPoints: [path.join(__dirname, 'webview', 'board.tsx')],
    outfile: path.join(__dirname, 'media', 'board.js'),
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
        console.log('[build-webview] watching webview/ -> media/board.js');
        return;
    }
    await esbuild.build(options);
}

main().catch((err) => {
    console.error('[build-webview] failed:', err);
    process.exit(1);
});
