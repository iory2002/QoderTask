import type { MrExtensionResponse, MrWebviewMessage, MrWebviewRequest } from '../src/models/MrBoard';

/**
 * 打包产物的可读标记：验收时在 WebView 里读 window.__MR_BOARD_BUNDLE__
 * 即可确认脚本来自 media/mr-board.js，而不是内联在 HTML 模板里。
 */
export const BUNDLE_VERSION = 'mr-board-webview@1';

declare global {
    interface Window {
        __MR_BOARD_BUNDLE__?: string;
    }
}

const api = typeof window.acquireVsCodeApi === 'function' ? window.acquireVsCodeApi() : undefined;

export function post(message: MrWebviewRequest): void {
    api?.postMessage(message as unknown as MrWebviewMessage);
}

export function onMessage(handler: (message: MrExtensionResponse) => void): () => void {
    const listener = (event: MessageEvent) => {
        const message = event.data as MrExtensionResponse | undefined;
        if (message && typeof message.type === 'string') {
            handler(message);
        }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
}
