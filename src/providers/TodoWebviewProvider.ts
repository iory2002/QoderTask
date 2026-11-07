import * as vscode from 'vscode';
import { TodoService } from '../services/TodoService';
import { Todo } from '../models/Todo';
import { JiraService } from '../services/JiraService';
import { GitLabService } from '../services/GitLabService';

/**
 * WebView 提供者：负责渲染侧边栏面板并与 WebView 通信
 */
export class TodoWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'todoPanel.webview';

    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _todoService: TodoService,
        private readonly _jiraService: JiraService,
        private readonly _gitlabService: GitLabService
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = this._getHtmlContent();

        // 监听来自 WebView 的消息
        webviewView.webview.onDidReceiveMessage(async (message: any) => {
            switch (message.command) {
                case 'getTodos':
                    await this._refreshTodos();
                    break;
                case 'addTodo':
                    await this._todoService.create({
                        title: message.title,
                        description: message.description || '',
                    });
                    await this._refreshTodos();
                    break;
                case 'toggleTodo':
                    await this._todoService.update(message.id, {
                        completed: message.completed,
                    });
                    await this._refreshTodos();
                    break;
                case 'updateTodo':
                    await this._todoService.update(message.id, {
                        title: message.title,
                        description: message.description,
                    });
                    await this._refreshTodos();
                    break;
                case 'deleteTodo':
                    await this._todoService.delete(message.id);
                    await this._refreshTodos();
                    break;
                case 'openUrl':
                    if (message.url) {
                        await vscode.env.openExternal(vscode.Uri.parse(message.url));
                    }
                    break;
                case 'addToChat':
                    if (message.title) {
                        try {
                            await vscode.commands.executeCommand('workbench.action.chat.open', {
                                query: message.title,
                                isPartialQuery: true,
                            });
                        } catch {
                            // 不支持 chat 命令时，复制到剪贴板
                            await vscode.env.clipboard.writeText(message.title);
                            vscode.window.showInformationMessage('已复制标题到剪贴板，请粘贴到对话中');
                        }
                    }
                    break;
                case 'reorderTodos':
                    await this._todoService.reorder(message.orderedIds);
                    await this._refreshTodos();
                    break;
                case 'syncJira':
                    await this._syncJira();
                    break;
                case 'syncGitLab':
                    await this._syncGitLab();
                    break;
            }
        });

        // 初始加载数据
        this._refreshTodos();
    }

    private async _refreshTodos(): Promise<void> {
        const todos = await this._todoService.getAll();
        this._view?.webview.postMessage({
            command: 'loadTodos',
            todos,
        });
    }

    /**
     * 同步 Jira 数据：拉取当前 Sprint 任务 → 替换旧 Jira 项 → 刷新
     */
    private async _syncJira(): Promise<void> {
        this._view?.webview.postMessage({ command: 'syncStart', source: 'jira' });
        try {
            const jiraItems = await this._jiraService.fetchMyCurrentSprintIssues();
            if (jiraItems === null) {
                await this._refreshTodos();
                this._view?.webview.postMessage({ command: 'syncDone', source: 'jira', count: -1, info: 'Jira 未配置或无活跃 Sprint' });
                return;
            }
            const service = this._todoService as any;
            if (typeof service.syncFromJira === 'function') {
                await service.syncFromJira(jiraItems);
            }
            await this._refreshTodos();
            this._view?.webview.postMessage({ command: 'syncDone', source: 'jira', count: jiraItems.length });
        } catch (err) {
            console.error('Jira sync failed:', err);
            vscode.window.showErrorMessage('Jira 同步失败: ' + (err as Error).message);
            this._view?.webview.postMessage({ command: 'syncDone', source: 'jira', count: 0, error: (err as Error).message });
        }
    }

    /**
     * 同步 GitLab MR 数据：拉取与我相关的 MR → 替换旧 MR 项 → 刷新
     */
    private async _syncGitLab(): Promise<void> {
        this._view?.webview.postMessage({ command: 'syncStart', source: 'gitlab' });
        try {
            const mrItems = await this._gitlabService.fetchMyMRs();
            if (mrItems === null) {
                await this._refreshTodos();
                this._view?.webview.postMessage({ command: 'syncDone', source: 'gitlab', count: -1, info: 'GitLab 未配置' });
                return;
            }
            const service = this._todoService as any;
            if (typeof service.syncFromGitLab === 'function') {
                await service.syncFromGitLab(mrItems);
            }
            await this._refreshTodos();
            this._view?.webview.postMessage({ command: 'syncDone', source: 'gitlab', count: mrItems.length });
        } catch (err) {
            console.error('GitLab sync failed:', err);
            vscode.window.showErrorMessage('GitLab 同步失败: ' + (err as Error).message);
            this._view?.webview.postMessage({ command: 'syncDone', source: 'gitlab', count: 0, error: (err as Error).message });
        }
    }

    public async refresh(): Promise<void> {
        await this._refreshTodos();
    }

    /**
     * 公开方法：由外部命令调用触发 Jira 同步
     */
    public async syncWithJira(): Promise<void> {
        await this._syncJira();
    }

    /**
     * 公开方法：由外部命令调用触发 GitLab 同步
     */
    public async syncWithGitLab(): Promise<void> {
        await this._syncGitLab();
    }

    /**
     * 公开方法：清除所有待办事项（带确认对话框）
     */
    public async clearAll(): Promise<void> {
        const answer = await vscode.window.showWarningMessage(
            '确定清除所有待办事项？此操作不可撤销。',
            '清除', '取消'
        );
        if (answer === '清除') {
            await this._todoService.clearAll();
            await this._refreshTodos();
        }
    }

    private _getHtmlContent(): string {
        return /* html */ `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Todo Panel</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            padding: 8px 12px;
        }

        /* 添加区域 */
        .add-section {
            margin-bottom: 12px;
        }
        .add-section input[type="text"] {
            width: 100%;
            padding: 6px 8px;
            margin-bottom: 6px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, transparent);
            border-radius: 2px;
            outline: none;
            font-size: 13px;
        }
        .add-section input[type="text"]:focus {
            border-color: var(--vscode-focusBorder);
        }
        .add-section textarea {
            width: 100%;
            padding: 6px 8px;
            margin-bottom: 6px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, transparent);
            border-radius: 2px;
            outline: none;
            font-size: 12px;
            resize: vertical;
            min-height: 40px;
            font-family: inherit;
        }
        .add-section textarea:focus {
            border-color: var(--vscode-focusBorder);
        }
        .btn-add {
            width: 100%;
            padding: 6px 12px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-size: 13px;
        }
        .btn-add:hover {
            background: var(--vscode-button-hoverBackground);
        }

        /* 待办列表 */
        .todo-list {
            list-style: none;
        }
        .todo-item {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            padding: 8px 6px;
            border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.2));
            transition: background 0.15s;
            position: relative;
        }
        .todo-item:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .todo-item.dragging {
            opacity: 0.4;
        }
        /* 插入指示线：上半区=插入到该项之前，下半区=插入到该项之后 */
        /* 整行高亮 + inset 纯色线，不依赖主题变量，保证可见 */
        .todo-item.drag-over-before,
        .todo-item.drag-over-after {
            background-color: rgba(0, 127, 212, 0.25) !important;
        }
        .todo-item.drag-over-before {
            box-shadow: inset 0 3px 0 0 #007fd4;
        }
        .todo-item.drag-over-after {
            box-shadow: inset 0 -3px 0 0 #007fd4;
        }
        .todo-item.completed .todo-title {
            text-decoration: line-through;
            opacity: 0.6;
        }
        .todo-checkbox {
            margin-top: 2px;
            cursor: pointer;
            width: 16px;
            height: 16px;
            accent-color: var(--vscode-checkbox-background, var(--vscode-button-background));
        }
        .todo-content {
            flex: 1;
            min-width: 0;
        }
        .todo-title {
            font-size: 13px;
            font-weight: 500;
            word-break: break-word;
        }
        .todo-desc {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
            word-break: break-word;
        }
        .todo-meta {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
            opacity: 0.7;
        }
        .status-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            line-height: 1.4;
            vertical-align: middle;
        }
        .status-open { background: #3A5A7F; color: #fff; }
        .status-in-progress { background: #FFD351; color: #2E4A1E; }
        .status-in-test { background: #FFD351; color: #2E4A1E; }
        .status-resolved { background: #10B981; color: #fff; }
        .status-closed { background: #6B7280; color: #fff; }
        .status-merged { background: #7C3AED; color: #fff; }
        .status-default { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
        .btn-delete {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            opacity: 0.4;
            font-size: 14px;
            padding: 2px 4px;
            line-height: 1;
        }
        .btn-delete:hover {
            opacity: 1;
            color: var(--vscode-errorForeground);
        }

        /* 统计 */
        .stats {
            margin-top: 12px;
            padding-top: 8px;
            border-top: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.2));
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            display: flex;
            justify-content: space-between;
        }

        /* 空状态 */
        .empty-state {
            text-align: center;
            padding: 24px 12px;
            color: var(--vscode-descriptionForeground);
            font-size: 13px;
        }

        /* 编辑模式 */
        .edit-input {
            width: 100%;
            padding: 4px 6px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-focusBorder);
            border-radius: 2px;
            font-size: 13px;
            margin-bottom: 4px;
        }

        /* 右键菜单 */
        .context-menu {
            display: none;
            position: fixed;
            z-index: 1000;
            min-width: 160px;
            background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
            color: var(--vscode-menu-foreground, var(--vscode-foreground));
            border: 1px solid var(--vscode-menu-border, rgba(128,128,128,0.3));
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            padding: 4px 0;
            font-size: 13px;
        }
        .context-menu.visible { display: block; }
        .context-menu-item {
            padding: 5px 14px;
            cursor: pointer;
            white-space: nowrap;
        }
        .context-menu-item:hover {
            background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
            color: var(--vscode-menu-selectionForeground, var(--vscode-foreground));
        }
        .context-menu-separator {
            height: 1px;
            background: var(--vscode-menu-separatorBackground, rgba(128,128,128,0.3));
            margin: 4px 0;
        }
        .context-menu-item.danger:hover {
            background: var(--vscode-errorForeground);
            color: #fff;
        }

        /* Jira 同步按钮 */
        .sync-bar {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 4px;
            margin-bottom: 10px;
        }
        .btn-sync {
            flex: 1;
            padding: 6px 10px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-size: 13px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }
        .btn-sync:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .btn-sync:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        .btn-sync .spinner {
            display: inline-block;
            width: 12px;
            height: 12px;
            border: 2px solid currentColor;
            border-right-color: transparent;
            border-radius: 50%;
            animation: spin 0.6s linear infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .sync-status {
            width: 100%;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            white-space: nowrap;
            text-align: center;
            min-height: 0;
        }
        .sync-status:empty {
            display: none;
        }

        /* 错误 banner */
        .error-banner {
            display: none;
            background: #c0392b;
            color: #000;
            font-size: 12px;
            font-weight: 600;
            padding: 6px 10px;
            border-radius: 2px;
            margin-bottom: 10px;
            word-break: break-word;
        }
        .error-banner.visible {
            display: block;
        }

        /* 过滤栏 */
        .filter-bar {
            display: flex;
            gap: 4px;
            margin-bottom: 10px;
        }
        .btn-filter {
            flex: 1;
            padding: 4px 6px;
            font-size: 12px;
            background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
            color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
            border: 1px solid var(--vscode-button-border, transparent);
            border-radius: 2px;
            cursor: pointer;
            text-align: center;
        }
        .btn-filter:hover {
            background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
        }
        .btn-filter.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            font-weight: 600;
        }
        .filter-count {
            font-size: 10px;
            opacity: 0.7;
            margin-left: 2px;
        }
    </style>
</head>
<body>
    <div class="sync-bar">
        <button class="btn-sync" id="btnSyncJira" onclick="syncJira()">
            <span id="syncJiraIcon">&#x21bb;</span>
            <span id="syncJiraText">Jira</span>
        </button>
        <button class="btn-sync" id="btnSyncGitLab" onclick="syncGitLab()">
            <span id="syncGitLabIcon">&#x21bb;</span>
            <span id="syncGitLabText">GitLab</span>
        </button>
        <span class="sync-status" id="syncStatus"></span>
    </div>

    <div class="error-banner" id="errorBanner"></div>

    <div class="filter-bar">
        <button class="btn-filter active" id="filterAll" onclick="toggleFilter('all')">All <span class="filter-count" id="countAll"></span></button>
        <button class="btn-filter active" id="filterJira" onclick="toggleFilter('jira')">Jira <span class="filter-count" id="countJira"></span></button>
        <button class="btn-filter active" id="filterGitLab" onclick="toggleFilter('gitlab')">GitLab <span class="filter-count" id="countGitLab"></span></button>
        <button class="btn-filter active" id="filterUser" onclick="toggleFilter('user')">User <span class="filter-count" id="countUser"></span></button>
    </div>

    <div class="add-section">
        <input type="text" id="todoTitle" placeholder="输入待办事项标题..." />
        <textarea id="todoDesc" placeholder="描述（可选）..." rows="2"></textarea>
        <button class="btn-add" onclick="addTodo()">+ 添加待办</button>
    </div>

    <ul class="todo-list" id="todoList"></ul>

    <div class="stats" id="stats" style="display:none;">
        <span id="statsText"></span>
    </div>

    <div class="empty-state" id="emptyState" style="display:none;">
        暂无待办事项，添加一个吧！
    </div>

    <div class="context-menu" id="contextMenu"></div>

    <script>
        const vscode = acquireVsCodeApi();
        let todos = [];
        let activeFilters = new Set(['jira', 'gitlab', 'user']); // all selected by default

        function getFilteredTodos() {
            return todos.filter(t => {
                if (t.jiraKey) return activeFilters.has('jira');
                if (t.gitlabMrId) return activeFilters.has('gitlab');
                return activeFilters.has('user');
            });
        }

        function updateFilterCounts() {
            const jiraCount = todos.filter(t => t.jiraKey).length;
            const gitlabCount = todos.filter(t => t.gitlabMrId).length;
            const userCount = todos.filter(t => !t.jiraKey && !t.gitlabMrId).length;
            document.getElementById('countAll').textContent = '(' + todos.length + ')';
            document.getElementById('countJira').textContent = '(' + jiraCount + ')';
            document.getElementById('countGitLab').textContent = '(' + gitlabCount + ')';
            document.getElementById('countUser').textContent = '(' + userCount + ')';
        }

        function updateFilterButtons() {
            const allActive = activeFilters.has('jira') && activeFilters.has('gitlab') && activeFilters.has('user');
            document.getElementById('filterAll').classList.toggle('active', allActive);
            document.getElementById('filterJira').classList.toggle('active', activeFilters.has('jira'));
            document.getElementById('filterGitLab').classList.toggle('active', activeFilters.has('gitlab'));
            document.getElementById('filterUser').classList.toggle('active', activeFilters.has('user'));
        }

        function toggleFilter(type) {
            if (type === 'all') {
                // Toggle all on/off
                const allActive = activeFilters.has('jira') && activeFilters.has('gitlab') && activeFilters.has('user');
                if (allActive) {
                    activeFilters.clear();
                } else {
                    activeFilters = new Set(['jira', 'gitlab', 'user']);
                }
            } else {
                // Toggle individual filter
                if (activeFilters.has(type)) {
                    activeFilters.delete(type);
                } else {
                    activeFilters.add(type);
                }
            }
            updateFilterButtons();
            renderTodos();
        }

        // 监听来自 Extension 的消息
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'loadTodos') {
                todos = message.todos;
                renderTodos();
            } else if (message.command === 'syncStart') {
                setSyncLoading(true, message.source);
            } else if (message.command === 'syncDone') {
                setSyncLoading(false, message.source);
                const status = document.getElementById('syncStatus');
                const label = message.source === 'gitlab' ? 'GitLab' : 'Jira';
                if (message.error) {
                    const banner = document.getElementById('errorBanner');
                    banner.textContent = label + ' 同步失败: ' + message.error;
                    banner.classList.add('visible');
                    status.textContent = '';
                } else if (message.count < 0) {
                    document.getElementById('errorBanner').classList.remove('visible');
                    status.textContent = message.info || '';
                    status.style.color = 'var(--vscode-descriptionForeground)';
                    setTimeout(() => { status.textContent = ''; }, 5000);
                } else {
                    document.getElementById('errorBanner').classList.remove('visible');
                    status.textContent = label + ' 已同步 ' + message.count + ' 条';
                    status.style.color = 'var(--vscode-descriptionForeground)';
                    setTimeout(() => { status.textContent = ''; }, 5000);
                }
            }
        });

        // 初始加载
        vscode.postMessage({ command: 'getTodos' });

        function syncJira() {
            vscode.postMessage({ command: 'syncJira' });
        }

        function syncGitLab() {
            vscode.postMessage({ command: 'syncGitLab' });
        }

        function setSyncLoading(loading, source) {
            const idSuffix = source === 'gitlab' ? 'GitLab' : 'Jira';
            const btn = document.getElementById('btnSync' + idSuffix);
            const icon = document.getElementById('sync' + idSuffix + 'Icon');
            const text = document.getElementById('sync' + idSuffix + 'Text');
            const label = source === 'gitlab' ? 'GitLab' : 'Jira';
            if (loading) {
                btn.disabled = true;
                icon.innerHTML = '<span class="spinner"></span>';
                text.textContent = '同步中...';
            } else {
                btn.disabled = false;
                icon.innerHTML = '&#x21bb;';
                text.textContent = label;
            }
        }

        function addTodo() {
            const titleInput = document.getElementById('todoTitle');
            const descInput = document.getElementById('todoDesc');
            const title = titleInput.value.trim();
            if (!title) { return; }
            vscode.postMessage({
                command: 'addTodo',
                title: title,
                description: descInput.value.trim(),
            });
            titleInput.value = '';
            descInput.value = '';
        }

        function toggleTodo(id, completed) {
            vscode.postMessage({
                command: 'toggleTodo',
                id: id,
                completed: !completed,
            });
        }

        function deleteTodo(id) {
            vscode.postMessage({
                command: 'deleteTodo',
                id: id,
            });
        }

        function startEdit(id) {
            const todo = todos.find(t => t.id === id);
            if (!todo) { return; }
            const item = document.getElementById('todo-' + id);
            const contentEl = item.querySelector('.todo-content');
            contentEl.innerHTML = 
                '<input class="edit-input" id="edit-title-' + id + '" value="' + escapeHtml(todo.title) + '" />' +
                '<input class="edit-input" id="edit-desc-' + id + '" value="' + escapeHtml(todo.description) + '" placeholder="描述..." />' +
                '<button class="btn-add" style="margin-top:4px;font-size:12px;padding:4px 8px;" onclick="saveEdit(\\'' + id + '\\')">保存</button>' +
                '<button class="btn-delete" style="margin-top:4px;margin-left:4px;opacity:0.7;" onclick="cancelEdit()">取消</button>';
            document.getElementById('edit-title-' + id).focus();
        }

        function saveEdit(id) {
            const title = document.getElementById('edit-title-' + id).value.trim();
            const description = document.getElementById('edit-desc-' + id).value.trim();
            if (!title) { return; }
            vscode.postMessage({
                command: 'updateTodo',
                id: id,
                title: title,
                description: description,
            });
        }

        function cancelEdit() {
            renderTodos();
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function formatDate(iso) {
            const d = new Date(iso);
            return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        }

        function getStatusBadge(status) {
            if (!status) return '';
            const key = status.toLowerCase().replace(/ /g, '-');
            const colorMap = {
                'open': 'background:#3A5A7F;color:#fff',
                'in-progress': 'background:#FFD351;color:#2E4A1E',
                'in-test': 'background:#9FFCFD;color:#1A3A3A',
                'resolved': 'background:#10B981;color:#fff',
                'closed': 'background:#6B7280;color:#fff',
                'merged': 'background:#7C3AED;color:#fff',
                'opened': 'background:#3A5A7F;color:#fff'
            };
            const style = colorMap[key] || 'background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)';
            return '<span style="display:inline-block;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:600;line-height:1.4;vertical-align:middle;margin-left:6px;' + style + '">' + escapeHtml(status) + '</span>';
        }

        function renderTodos() {
            const list = document.getElementById('todoList');
            const empty = document.getElementById('emptyState');
            const stats = document.getElementById('stats');
            const statsText = document.getElementById('statsText');

            updateFilterCounts();
            const filtered = getFilteredTodos();

            if (filtered.length === 0) {
                list.innerHTML = '';
                empty.style.display = 'block';
                empty.textContent = todos.length === 0 ? '\u6682\u65e0\u5f85\u529e\u4e8b\u9879\uff0c\u6dfb\u52a0\u4e00\u4e2a\u5427\uff01' : '\u5f53\u524d\u8fc7\u6ee4\u6761\u4ef6\u4e0b\u65e0\u5f85\u529e\u4e8b\u9879';
                stats.style.display = 'none';
                return;
            }

            empty.style.display = 'none';
            stats.style.display = 'flex';
            const done = filtered.filter(t => t.completed).length;
            statsText.textContent = done + ' / ' + filtered.length + ' \u5df2\u5b8c\u6210';

            list.innerHTML = filtered.map(todo => 
                '<li class="todo-item ' + (todo.completed ? 'completed' : '') + '" id="todo-' + todo.id + '" data-id="' + todo.id + '" data-url="' + (todo.url ? escapeHtml(todo.url) : '') + '" draggable="true">' +
                    '<input type="checkbox" class="todo-checkbox" ' + (todo.completed ? 'checked' : '') + ' onchange="toggleTodo(\\'' + todo.id + '\\', ' + todo.completed + ')" />' +
                    '<div class="todo-content">' +
                        '<div class="todo-title">' + escapeHtml(todo.title) + '</div>' +
                        (todo.description || todo.status ? '<div class="todo-desc">' + (todo.description ? escapeHtml(todo.description) + ' ' : '') + getStatusBadge(todo.status) + '</div>' : '') +
                        '<div class="todo-meta">' + formatDate(todo.createdAt) + '</div>' +
                    '</div>' +
                    '<button class="btn-delete" title="编辑" onclick="startEdit(\\'' + todo.id + '\\')">&#9998;</button>' +
                    '<button class="btn-delete" title="删除" onclick="deleteTodo(\\'' + todo.id + '\\')">&#10005;</button>' +
                '</li>'
            ).join('');
        }

        // Enter 键快速添加
        document.getElementById('todoTitle').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { addTodo(); }
        });

        // ========== 拖拽排序 ==========
        let draggedId = null;
        const todoListEl = document.getElementById('todoList');

        function clearDragStyles() {
            document.querySelectorAll('.todo-item.drag-over-before, .todo-item.drag-over-after').forEach(el => el.classList.remove('drag-over-before', 'drag-over-after'));
            document.querySelectorAll('.todo-item.dragging').forEach(el => el.classList.remove('dragging'));
        }

        todoListEl.addEventListener('dragstart', function(e) {
            // 从输入框/按钮发起的拖拽直接取消，保留文本选择与编辑交互
            if (e.target.closest('input, textarea, button')) {
                e.preventDefault();
                return;
            }
            const li = e.target.closest('.todo-item');
            if (!li) { return; }
            draggedId = li.dataset.id;
            li.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            // Chromium 必需：不 setData 则拖拽 ghost 不显示、dragover/drop 不触发
            e.dataTransfer.setData('text/plain', 'todo:' + draggedId);
        });

        todoListEl.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const li = e.target.closest('.todo-item');
            // 清除上一处指示线
            document.querySelectorAll('.todo-item.drag-over-before, .todo-item.drag-over-after').forEach(el => el.classList.remove('drag-over-before', 'drag-over-after'));
            if (!li || li.dataset.id === draggedId) { return; }
            // 鼠标在目标项上半区=插入之前，下半区=插入之后
            const rect = li.getBoundingClientRect();
            const isAfter = (e.clientY - rect.top) > rect.height / 2;
            li.classList.add(isAfter ? 'drag-over-after' : 'drag-over-before');
        });

        todoListEl.addEventListener('drop', function(e) {
            e.preventDefault();
            const li = e.target.closest('.todo-item');
            if (!li || !draggedId || li.dataset.id === draggedId) {
                clearDragStyles();
                draggedId = null;
                return;
            }
            const fromIndex = todos.findIndex(t => t.id === draggedId);
            let toIndex = todos.findIndex(t => t.id === li.dataset.id);
            if (fromIndex === -1 || toIndex === -1) { return; }
            // 鼠标在目标项下半区：插入到目标项之后
            if (li.classList.contains('drag-over-after')) { toIndex += 1; }
            // 向下拖动时补偿索引，保持插入语义
            if (fromIndex < toIndex) { toIndex -= 1; }
            // 移动数组元素
            const moved = todos.splice(fromIndex, 1)[0];
            todos.splice(toIndex, 0, moved);
            clearDragStyles();
            draggedId = null;
            renderTodos();
            // 通知 Extension 持久化新顺序
            vscode.postMessage({ command: 'reorderTodos', orderedIds: todos.map(t => t.id) });
        });

        todoListEl.addEventListener('dragend', function() {
            clearDragStyles();
            draggedId = null;
        });

        // ========== 右键菜单 ==========
        const contextMenu = document.getElementById('contextMenu');
        let currentTodoId = null;

        function showContextMenu(e, todo) {
            e.preventDefault();
            currentTodoId = todo.id;
            let items = '';
            if (todo.url) {
                items += '<div class="context-menu-item" data-action="openUrl">在浏览器中打开</div>';
            }
            items += '<div class="context-menu-item" data-action="copy">复制标题</div>';
            items += '<div class="context-menu-item" data-action="addToChat">添加到对话</div>';
            items += '<div class="context-menu-item" data-action="toggle">' + (todo.completed ? '取消完成' : '标记完成') + '</div>';
            items += '<div class="context-menu-item" data-action="edit">编辑</div>';
            items += '<div class="context-menu-separator"></div>';
            items += '<div class="context-menu-item danger" data-action="delete">删除</div>';
            contextMenu.innerHTML = items;
            contextMenu.classList.add('visible');
            // 定位（避免超出边界）
            const menuW = 170, menuH = contextMenu.offsetHeight || 150;
            let x = e.clientX, y = e.clientY;
            if (x + menuW > window.innerWidth) { x = window.innerWidth - menuW; }
            if (y + menuH > window.innerHeight) { y = window.innerHeight - menuH; }
            contextMenu.style.left = x + 'px';
            contextMenu.style.top = y + 'px';
        }

        function hideContextMenu() {
            contextMenu.classList.remove('visible');
        }

        // 在列表上右键待办项时弹出菜单
        document.getElementById('todoList').addEventListener('contextmenu', function(e) {
            const li = e.target.closest('.todo-item');
            if (!li) { return; }
            const todo = todos.find(t => t.id === li.dataset.id);
            if (todo) { showContextMenu(e, todo); }
        });

        // 菜单项点击
        contextMenu.addEventListener('click', function(e) {
            const action = e.target.dataset.action;
            if (!action) { return; }
            const todo = todos.find(t => t.id === currentTodoId);
            hideContextMenu();
            if (!todo) { return; }
            switch (action) {
                case 'openUrl':
                    vscode.postMessage({ command: 'openUrl', url: todo.url });
                    break;
                case 'copy':
                    navigator.clipboard.writeText(todo.title);
                    break;
                case 'addToChat':
                    vscode.postMessage({ command: 'addToChat', title: todo.title });
                    break;
                case 'toggle':
                    toggleTodo(todo.id, todo.completed);
                    break;
                case 'edit':
                    startEdit(todo.id);
                    break;
                case 'delete':
                    deleteTodo(todo.id);
                    break;
            }
        });

        // 点击其他区域或滚动时关闭菜单
        document.addEventListener('click', function(e) {
            if (!contextMenu.contains(e.target)) { hideContextMenu(); }
        });
        window.addEventListener('scroll', hideContextMenu);
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') { hideContextMenu(); }
        });
    </script>
</body>
</html>`;
    }
}
