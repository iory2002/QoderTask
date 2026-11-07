import { render } from 'preact';

import { App } from './App';
import { BUNDLE_VERSION } from './api';

// 可读标记：证明这段脚本来自 media/board.js（打包产物），而不是 HTML 模板内联
window.__JIRA_BOARD_BUNDLE__ = BUNDLE_VERSION;

const root = document.getElementById('board-root');
if (root) {
    root.dataset.bundle = BUNDLE_VERSION;
    render(<App />, root);
} else {
    console.error('[jira-board] #board-root not found');
}
