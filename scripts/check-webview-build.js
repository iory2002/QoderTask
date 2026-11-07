/**
 * 打包前的闸门：media/board.js 缺失或为空时直接失败，
 * 避免发出一个打开只显示白屏的 vsix。
 */
const fs = require('fs');
const path = require('path');

const bundle = path.join(__dirname, '..', 'media', 'board.js');

if (!fs.existsSync(bundle)) {
    console.error(`[check-webview-build] 缺少 ${path.relative(process.cwd(), bundle)}：先跑 npm run build:webview`);
    process.exit(1);
}

const { size } = fs.statSync(bundle);
if (size < 1024) {
    console.error(`[check-webview-build] ${path.relative(process.cwd(), bundle)} 只有 ${size} 字节，怀疑是空产物`);
    process.exit(1);
}

console.log(`[check-webview-build] ok: media/board.js ${(size / 1024).toFixed(1)} KiB`);
