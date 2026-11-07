import * as vscode from 'vscode';
import { TodoWebviewProvider } from './providers/TodoWebviewProvider';
import { LocalFileTodoService } from './services/LocalFileTodoService';
import { JiraService } from './services/JiraService';
import { GitLabService } from './services/GitLabService';
import { BoardPanel } from './board/BoardPanel';
import { BoardEntryView } from './board/BoardEntryView';
import { BoardState } from './board/BoardState';

let provider: TodoWebviewProvider;
let service: LocalFileTodoService;
let boardState: BoardState | undefined;

export function activate(context: vscode.ExtensionContext) {
    try {
        // 使用工作区存储路径，若无工作区则使用全局存储
        const storagePath = context.storageUri?.fsPath || context.globalStorageUri.fsPath;

        // 初始化数据服务（可替换为其他实现）
        service = new LocalFileTodoService(storagePath);

        // 初始化 Jira 服务
        const jiraService = new JiraService();

        // 初始化 GitLab 服务
        const gitlabService = new GitLabService();

        // 注册 WebView 提供者
        provider = new TodoWebviewProvider(context.extensionUri, service, jiraService, gitlabService);

        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(
                TodoWebviewProvider.viewType,
                provider,
                { webviewOptions: { retainContextWhenHidden: true } }
            )
        );

        // 注册命令
        context.subscriptions.push(
            vscode.commands.registerCommand('todoPanel.addTodo', () => {
                provider.refresh();
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('todoPanel.refresh', () => {
                provider.syncWithJira();
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('todoPanel.syncGitLab', () => {
                provider.syncWithGitLab();
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('todoPanel.clearAll', () => {
                provider.clearAll();
            })
        );

        registerBoard(context);
        context.subscriptions.push({ dispose: () => boardState?.dispose() });

        console.log('Todo Panel extension activated, storage:', storagePath);
    } catch (err) {
        console.error('Todo Panel activation failed:', err);
        vscode.window.showErrorMessage('Todo Panel activation failed: ' + err);
    }
}

function registerBoard(context: vscode.ExtensionContext): void {
    boardState = new BoardState();

    const openBoard = () => {
        BoardPanel.createOrShow(context.extensionUri, {
            onReady: () => boardState?.refresh(true),
            onRefresh: (force) => boardState?.refresh(force),
            onScopeChange: (scope) => {
                boardState?.setScope(scope);
                return boardState?.refresh(true);
            },
            onOpenJira: (key) => openJiraIssue(key),
            onOpenExternal: (url) => openExternal(url),
            onVisibilityChanged: (visible) => {
                if (visible) {
                    void boardState?.refresh(false);
                }
            },
        });
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('todoPanel.openBoard', () => openBoard())
    );

    const entry = new BoardEntryView(context.extensionUri, openBoard);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(BoardEntryView.viewType, entry, {
            webviewOptions: { retainContextWhenHidden: false },
        })
    );
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
