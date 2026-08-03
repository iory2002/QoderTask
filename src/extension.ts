import * as vscode from 'vscode';
import { TodoWebviewProvider } from './providers/TodoWebviewProvider';
import { LocalFileTodoService } from './services/LocalFileTodoService';

let provider: TodoWebviewProvider;
let service: LocalFileTodoService;

export function activate(context: vscode.ExtensionContext) {
    try {
        // 使用工作区存储路径，若无工作区则使用全局存储
        const storagePath = context.storageUri?.fsPath || context.globalStorageUri.fsPath;

        // 初始化数据服务（可替换为其他实现）
        service = new LocalFileTodoService(storagePath);

        // 注册 WebView 提供者
        provider = new TodoWebviewProvider(context.extensionUri, service);

        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(
                TodoWebviewProvider.viewType,
                provider,
                { webviewOptions: { retainContextWhenHidden: true } }
            )
        );

        // 首次激活时自动加载演示数据
        const demoData = [
            { title: '完成 Q3 季度项目汇报 PPT', description: '' },
            { title: 'Review 团队提交的 PR #42 和 #43', description: '重点检查 auth 模块' },
            { title: '修复登录页面在 Safari 下的样式兼容问题', description: '用户反馈按钮错位' },
            { title: '编写用户模块的单元测试', description: '覆盖率提升到 80%' },
            { title: '和产品经理确认 v2.5 需求变更细节', description: '' },
            { title: '更新 API 文档', description: '补充新增的 WebSocket 接口说明' },
            { title: '优化首页加载速度', description: '目标 < 2s' },
            { title: '准备周五的技术分享', description: 'React Server Components 实践' },
            { title: '清理数据库中的过期测试数据', description: '' },
            { title: '配置 CI/CD 流水线的自动化部署流程', description: '使用 GitHub Actions' },
        ];

        service.getAll().then(todos => {
            if (todos.length === 0) {
                demoData.forEach(item => service.create(item));
                console.log('Demo data loaded automatically');
            }
        });

        // 注册命令
        context.subscriptions.push(
            vscode.commands.registerCommand('todoPanel.addTodo', () => {
                provider.refresh();
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('todoPanel.refresh', () => {
                provider.refresh();
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('todoPanel.loadDemo', async () => {
                for (const item of demoData) {
                    await service.create(item);
                }
                provider.refresh();
                vscode.window.showInformationMessage('已加载 10 条演示待办事项！');
            })
        );

        console.log('Todo Panel extension activated, storage:', storagePath);
    } catch (err) {
        console.error('Todo Panel activation failed:', err);
        vscode.window.showErrorMessage('Todo Panel activation failed: ' + err);
    }
}

export function deactivate() {}
