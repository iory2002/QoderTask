import type { ExtensionResponse, WebviewMessage, WebviewRequest } from '../src/models/Board';

/**
 * 打包产物的可读标记。验收时在 WebView 里读 window.__JIRA_BOARD_BUNDLE__ 即可确认
 * 脚本确实来自 media/board.js，而不是内联在 HTML 模板里。
 */
export const BUNDLE_VERSION = 'board-webview@1';

declare global {
    interface Window {
        __JIRA_BOARD_BUNDLE__?: string;
        acquireVsCodeApi?: () => {
            postMessage(message: WebviewMessage): void;
            getState(): unknown;
            setState(state: unknown): void;
        };
    }
}

const api = typeof window.acquireVsCodeApi === 'function' ? window.acquireVsCodeApi() : undefined;

export function post(message: WebviewRequest): void {
    api?.postMessage(message as WebviewMessage);
}

export function onMessage(handler: (message: ExtensionResponse) => void): () => void {
    const listener = (event: MessageEvent) => {
        const message = event.data as ExtensionResponse | undefined;
        if (message && typeof message.type === 'string') {
            handler(message);
        }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
}

/** 在浏览器里直接打开 media/board.js 调试时使用 */
export const inIde = api !== undefined;
