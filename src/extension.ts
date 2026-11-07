import * as vscode from 'vscode';

import { BoardEntryView } from './board/BoardEntryView';
import { BoardPanel } from './board/BoardPanel';
import { BoardState } from './board/BoardState';
import { JiraService } from './services/JiraService';

let boardState: BoardState | undefined;

export function activate(context: vscode.ExtensionContext) {
    try {
        boardState = new BoardState();

        const openBoard = () => {
            BoardPanel.createOrShow(context.extensionUri, {
                onReady: () => {
                    boardState?.setVisible(true);
                    // WebView 可能刚被重建：即使数据没变也要把当前状态推过去
                    boardState?.republish();
                },
                onRefresh: (force) => boardState?.refresh(force),
                onScopeChange: (scope) => {
                    boardState?.setScope(scope);
                    return boardState?.refresh(true);
                },
                onFetchTransitions: (key) => boardState?.fetchTransitions(key),
                onTransition: (request) => boardState?.transition(request),
                onOpenJira: (key) => openJiraIssue(key),
                onOpenExternal: (url) => openExternal(url),
                onVisibilityChanged: (visible) => boardState?.setVisible(visible),
                onDisposed: () => boardState?.setVisible(false),
            });
        };

        context.subscriptions.push(
            vscode.commands.registerCommand('todoPanel.openBoard', () => openBoard())
        );

        // 原来的「同步 Jira」命令重定义为「刷新看板」，不再有语义重叠的入口
        context.subscriptions.push(
            vscode.commands.registerCommand('todoPanel.refresh', async () => {
                if (!BoardPanel.exists()) {
                    openBoard();
                    return;
                }
                await boardState?.refresh(true);
            })
        );

        const entry = new BoardEntryView(context.extensionUri, openBoard);
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(BoardEntryView.viewType, entry, {
                webviewOptions: { retainContextWhenHidden: false },
            })
        );

        context.subscriptions.push({ dispose: () => boardState?.dispose() });
        console.log('[jira-board] extension activated');
    } catch (error) {
        console.error('[jira-board] activation failed', error);
        vscode.window.showErrorMessage(`Jira Board 启动失败：${error}`);
    }
}

async function openJiraIssue(key: string): Promise<void> {
    const jira = new JiraService();
    await openExternal(jira.browseUrl(key));
}

async function openExternal(url: string): Promise<void> {
    if (!/^https?:\/\//i.test(url)) {
        vscode.window.showWarningMessage(`拒绝打开非 http(s) 链接：${url}`);
        return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(url));
}

export function deactivate() {
    boardState?.dispose();
    boardState = undefined;
}
