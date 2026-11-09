/**
 * 打包前的闸门：media/ 下的 WebView bundle 缺失或为空时直接失败，
 * 避免发出一个打开只显示白屏的 vsix。
 */
const fs = require('fs');
const path = require('path');

const bundles = ['board.js', 'mr-board.js'];

let failed = false;

for (const name of bundles) {
    const bundle = path.join(__dirname, '..', 'media', name);
    if (!fs.existsSync(bundle)) {
        console.error(`[check-webview-build] 缺少 ${path.relative(process.cwd(), bundle)}：先跑 npm run build:webview`);
        failed = true;
        continue;
    }

    const { size } = fs.statSync(bundle);
    if (size < 1024) {
        console.error(`[check-webview-build] ${path.relative(process.cwd(), bundle)} 只有 ${size} 字节，怀疑是空产物`);
        failed = true;
        continue;
    }

    console.log(`[check-webview-build] ok: media/${name} ${(size / 1024).toFixed(1)} KiB`);
}

if (failed) {
    process.exit(1);
}
