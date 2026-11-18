import * as crypto from 'crypto';
import * as vscode from 'vscode';

import type { BoardScope, CardDensity, ExtensionResponse, StageFilterId, WebviewMessage } from '../models/Board';

/**
 * 看板面板把「用户做了什么」交给外部的状态层处理。
 * 每个阶段只实现自己需要的那几个回调，未实现的请求会被忽略并记日志。
 */
export interface BoardPanelDelegate {
    onReady(panel: BoardPanel): void | Promise<void>;
    onRefresh(force: boolean): void | Promise<void>;
    onScopeChange(scope: BoardScope): void | Promise<void>;
    /** 切换卡片密度：详细 / 精简（纯视图偏好） */
    onDensityChange(density: CardDensity): void | Promise<void>;
    /** 勾选要看的交付阶段徽章（纯视图偏好，不重新取数） */
    onStageFilterChange(stages: StageFilterId[]): void | Promise<void>;
    /** 勾选要看显示的列：写回 pcBoard.hiddenColumns */
    onVisibleColumnsChange(visibleColumnIds: string[]): void | Promise<void>;
    onOpenJira(key: string): void | Promise<void>;
    /** 把卡片指派给当前 Jira 用户（看板唯一的写操作） */
    onAssignToMe(key: string): void | Promise<void>;
    onOpenExternal(url: string): void | Promise<void>;
    onVisibilityChanged(visible: boolean): void;
    onDisposed(): void;
}

export type BoardPanelHandlers = Partial<BoardPanelDelegate>;

/**
 * 工作区 tab 里的 Jira 看板。
 *
 * 只做窗口与消息管道：所有 HTTP 与凭据都留在扩展进程，
 * WebView 里跑的是 media/board.js（esbuild 产物，走 asWebviewUri）。
 */
export class BoardPanel {
    public static readonly viewType = 'jiraBoard.panel';
    private static current: BoardPanel | undefined;

    private readonly disposables: vscode.Disposable[] = [];
    private handlers: BoardPanelHandlers;

    /** 关掉 tab 后再次打开是同一个面板实例；点活动栏图标不重复开 tab */
    public static createOrShow(extensionUri: vscode.Uri, handlers: BoardPanelHandlers): BoardPanel {
        if (BoardPanel.current) {
            BoardPanel.current.panel.reveal(vscode.ViewColumn.Active, false);
            BoardPanel.current.handlers = handlers;
            return BoardPanel.current;
        }
        const panel = vscode.window.createWebviewPanel(
            BoardPanel.viewType,
            'Jira Board',
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
            }
        );
        const created = new BoardPanel(panel, extensionUri, handlers);
        BoardPanel.current = created;
        return created;
    }

    public static exists(): boolean {
        return BoardPanel.current !== undefined;
    }

    public static post(message: ExtensionResponse): void {
        BoardPanel.current?.send(message);
    }

    private constructor(
        private readonly panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        handlers: BoardPanelHandlers
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
            (message: WebviewMessage) => this.dispatch(message),
            null,
            this.disposables
        );
    }

    public get isVisible(): boolean {
        return this.panel.visible;
    }

    public send(message: ExtensionResponse): void {
        void this.panel.webview.postMessage(message);
    }

    public reveal(): void {
        this.panel.reveal(vscode.ViewColumn.Active, false);
    }

    public dispose(): void {
        BoardPanel.current = undefined;
        this.handlers.onDisposed?.();
        while (this.disposables.length) {
            this.disposables.pop()?.dispose();
        }
        this.panel.dispose();
    }

    private dispatch(message: WebviewMessage): void {
        const run = async () => {
            switch (message.type) {
                case 'board:ready':
                    await this.handlers.onReady?.(this);
                    return;
                case 'board:refresh':
                    await this.handlers.onRefresh?.((message.payload as { force?: boolean } | undefined)?.force ?? false);
                    return;
                case 'board:setScope':
                    await this.handlers.onScopeChange?.(message.payload as BoardScope);
                    return;
                case 'board:setDensity':
                    await this.handlers.onDensityChange?.(
                        (message.payload as { density: CardDensity }).density
                    );
                    return;
                case 'board:setStages': {
                    // 缺 payload 时不能当成「一个都不勾」：那会把整块看板变空
                    const stages = (message.payload as { stages?: StageFilterId[] } | undefined)?.stages;
                    if (Array.isArray(stages)) {
                        await this.handlers.onStageFilterChange?.(stages);
                    }
                    return;
                }
                case 'board:setVisibleColumns':
                    await this.handlers.onVisibleColumnsChange?.(
                        (message.payload as { visibleColumnIds: string[] }).visibleColumnIds ?? []
                    );
                    return;
                case 'card:openJira':
                    await this.handlers.onOpenJira?.((message.payload as { key: string }).key);
                    return;
                case 'card:assignToMe':
                    await this.handlers.onAssignToMe?.((message.payload as { key: string }).key);
                    return;
                case 'board:openExternal':
                    await this.handlers.onOpenExternal?.((message.payload as { url: string }).url);
                    return;
                default:
                    console.warn('[jira-board] unknown webview message', message);
            }
        };
        void run().catch((err: unknown) => {
            const message2 = err instanceof Error ? err.message : String(err);
            console.error('[jira-board] failed to handle webview message', message.type, err);
            this.send({ type: 'board:error', requestId: message.requestId, payload: { message: message2 } });
        });
    }

    private renderHtml(extensionUri: vscode.Uri): string {
        const webview = this.panel.webview;
        const nonce = crypto.randomBytes(16).toString('base64');
        const asset = (name: string) =>
            webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', name)).toString();

        // 脚本只从 media/ 里的打包产物加载，绝不内联进模板字符串：
        // 模板字符串会吃掉反斜杠，曾把 /\s+/g 变成 /s+/g。
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
<link rel="stylesheet" href="${asset('board.css')}">
<title>Jira Board</title>
</head>
<body>
<div id="board-root"></div>
<script nonce="${nonce}" src="${asset('board.js')}"></script>
</body>
</html>`;
    }
}
