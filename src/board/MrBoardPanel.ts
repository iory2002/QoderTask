import * as crypto from 'crypto';
import * as vscode from 'vscode';

import type { MrExtensionResponse, MrWebviewMessage } from '../models/MrBoard';

export interface MrBoardPanelDelegate {
    onReady(panel: MrBoardPanel): void | Promise<void>;
    onRefresh(force: boolean): void | Promise<void>;
    onOpenExternal(url: string): void | Promise<void>;
    onOpenJira(key: string): void | Promise<void>;
    onReview(payload: { iid: number; projectPath: string }): void | Promise<void>;
    onCopyLink(url: string): void | Promise<void>;
    onVisibilityChanged(visible: boolean): void;
    onDisposed(): void;
}

export type MrBoardPanelHandlers = Partial<MrBoardPanelDelegate>;

/**
 * 工作区 tab 里的 GitLab Board。
 *
 * 与 Jira 看板同构：只做窗口与消息管道，HTTP / 剪贴板 / 文件写入都留在扩展进程。
 */
export class MrBoardPanel {
    public static readonly viewType = 'mrBoard.panel';
    private static current: MrBoardPanel | undefined;

    private readonly disposables: vscode.Disposable[] = [];
    private handlers: MrBoardPanelHandlers;

    public static createOrShow(extensionUri: vscode.Uri, handlers: MrBoardPanelHandlers): MrBoardPanel {
        if (MrBoardPanel.current) {
            MrBoardPanel.current.panel.reveal(vscode.ViewColumn.Active, false);
            MrBoardPanel.current.handlers = handlers;
            return MrBoardPanel.current;
        }
        const panel = vscode.window.createWebviewPanel(
            MrBoardPanel.viewType,
            'GitLab Board',
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
            }
        );
        const created = new MrBoardPanel(panel, extensionUri, handlers);
        MrBoardPanel.current = created;
        return created;
    }

    public static exists(): boolean {
        return MrBoardPanel.current !== undefined;
    }

    public static post(message: MrExtensionResponse): void {
        MrBoardPanel.current?.send(message);
    }

    private constructor(
        private readonly panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        handlers: MrBoardPanelHandlers
    ) {
        this.handlers = handlers;
        this.panel.iconPath = undefined;
        this.panel.webview.html = this.renderHtml(extensionUri);

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.onDidChangeViewState(
            () => this.handlers.onVisibilityChanged?.(this.panel.visible),
            null,
            this.disposables
        );
        this.panel.webview.onDidReceiveMessage(
            (message: MrWebviewMessage) => this.dispatch(message),
            null,
            this.disposables
        );
    }

    public get isVisible(): boolean {
        return this.panel.visible;
    }

    public send(message: MrExtensionResponse): void {
        void this.panel.webview.postMessage(message);
    }

    public reveal(): void {
        this.panel.reveal(vscode.ViewColumn.Active, false);
    }

    public dispose(): void {
        MrBoardPanel.current = undefined;
        this.handlers.onDisposed?.();
        while (this.disposables.length) {
            this.disposables.pop()?.dispose();
        }
        this.panel.dispose();
    }

    private dispatch(message: MrWebviewMessage): void {
        const run = async () => {
            switch (message.type) {
                case 'mrBoard:ready':
                    await this.handlers.onReady?.(this);
                    return;
                case 'mrBoard:refresh':
                    await this.handlers.onRefresh?.(
                        (message.payload as { force?: boolean } | undefined)?.force ?? false
                    );
                    return;
                case 'mr:openExternal':
                    await this.handlers.onOpenExternal?.((message.payload as { url: string }).url);
                    return;
                case 'mr:openJira':
                    await this.handlers.onOpenJira?.((message.payload as { key: string }).key);
                    return;
                case 'mr:review':
                    await this.handlers.onReview?.(
                        message.payload as { iid: number; projectPath: string }
                    );
                    return;
                case 'mr:copyLink':
                    await this.handlers.onCopyLink?.((message.payload as { url: string }).url);
                    return;
                default:
                    console.warn('[mr-board] unknown webview message', message);
            }
        };
        void run().catch((err: unknown) => {
            const text = err instanceof Error ? err.message : String(err);
            console.error('[mr-board] failed to handle webview message', message.type, err);
            this.send({ type: 'mrBoard:error', requestId: message.requestId, payload: { message: text } });
        });
    }

    private renderHtml(extensionUri: vscode.Uri): string {
        const webview = this.panel.webview;
        const nonce = crypto.randomBytes(16).toString('base64');
        const asset = (name: string) =>
            webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', name)).toString();

        // 脚本只从 media/ 里的打包产物加载，绝不内联进模板字符串：
        // 模板字符串会吃掉反斜杠（历史事故：/\s+/g 变成 /s+/g）。
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
<link rel="stylesheet" href="${asset('board.css')}">
<link rel="stylesheet" href="${asset('mr-board.css')}">
<title>GitLab Board</title>
</head>
<body>
<div id="mr-board-root"></div>
<script nonce="${nonce}" src="${asset('mr-board.js')}"></script>
</body>
</html>`;
    }
}
