"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const TodoWebviewProvider_1 = require("./providers/TodoWebviewProvider");
const LocalFileTodoService_1 = require("./services/LocalFileTodoService");
let provider;
let service;
function activate(context) {
    try {
        // 使用工作区存储路径，若无工作区则使用全局存储
        const storagePath = context.storageUri?.fsPath || context.globalStorageUri.fsPath;
        // 初始化数据服务（可替换为其他实现）
        service = new LocalFileTodoService_1.LocalFileTodoService(storagePath);
        // 注册 WebView 提供者
        provider = new TodoWebviewProvider_1.TodoWebviewProvider(context.extensionUri, service);
        context.subscriptions.push(vscode.window.registerWebviewViewProvider(TodoWebviewProvider_1.TodoWebviewProvider.viewType, provider, { webviewOptions: { retainContextWhenHidden: true } }));
        // 首次激活时自动加载演示数据
        const demoData = [
            { title: '完成 Q3 季度项目汇报 PPT', description: '', url: 'https://jira.example.com/browse/DEMO-101' },
            { title: 'Review 团队提交的 PR #42 和 #43', description: '重点检查 auth 模块', url: 'https://jira.example.com/browse/DEMO-102' },
            { title: '修复登录页面在 Safari 下的样式兼容问题', description: '用户反馈按钮错位', url: 'https://jira.example.com/browse/DEMO-103' },
            { title: '编写用户模块的单元测试', description: '覆盖率提升到 80%' },
            { title: '和产品经理确认 v2.5 需求变更细节', description: '', url: 'https://jira.example.com/browse/DEMO-105' },
            { title: '更新 API 文档', description: '补充新增的 WebSocket 接口说明' },
            { title: '优化首页加载速度', description: '目标 < 2s', url: 'https://jira.example.com/browse/DEMO-107' },
            { title: '准备周五的技术分享', description: 'React Server Components 实践' },
            { title: '清理数据库中的过期测试数据', description: '' },
            { title: '配置 CI/CD 流水线的自动化部署流程', description: '使用 GitHub Actions', url: 'https://jira.example.com/browse/DEMO-110' },
        ];
        service.getAll().then(todos => {
            if (todos.length === 0) {
                demoData.forEach(item => service.create(item));
                console.log('Demo data loaded automatically');
            }
        });
        // 注册命令
        context.subscriptions.push(vscode.commands.registerCommand('todoPanel.addTodo', () => {
            provider.refresh();
        }));
        context.subscriptions.push(vscode.commands.registerCommand('todoPanel.refresh', () => {
            provider.refresh();
        }));
        context.subscriptions.push(vscode.commands.registerCommand('todoPanel.loadDemo', async () => {
            for (const item of demoData) {
                await service.create(item);
            }
            provider.refresh();
            vscode.window.showInformationMessage('已加载 10 条演示待办事项！');
        }));
        console.log('Todo Panel extension activated, storage:', storagePath);
    }
    catch (err) {
        console.error('Todo Panel activation failed:', err);
        vscode.window.showErrorMessage('Todo Panel activation failed: ' + err);
    }
}
function deactivate() { }
//# sourceMappingURL=extension.js.map