import { render } from 'preact';

import { MrApp } from './MrApp';
import { BUNDLE_VERSION } from './mrApi';

// 可读标记：证明这段脚本来自 media/mr-board.js（打包产物），而不是 HTML 模板内联
window.__MR_BOARD_BUNDLE__ = BUNDLE_VERSION;

const root = document.getElementById('mr-board-root');
if (root) {
    root.dataset.bundle = BUNDLE_VERSION;
    render(<MrApp />, root);
} else {
    console.error('[mr-board] #mr-board-root not found');
}
