import * as vscode from 'vscode';
import { TodoWebviewProvider } from './providers/TodoWebviewProvider';
import { LocalFileTodoService } from './services/LocalFileTodoService';
import { JiraService } from './services/JiraService';
import { GitLabService } from './services/GitLabService';

let provider: TodoWebviewProvider;
let service: LocalFileTodoService;

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

        console.log('Todo Panel extension activated, storage:', storagePath);
    } catch (err) {
        console.error('Todo Panel activation failed:', err);
        vscode.window.showErrorMessage('Todo Panel activation failed: ' + err);
    }
}

export function deactivate() {}
