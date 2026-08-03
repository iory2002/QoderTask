import * as vscode from 'vscode';
import { TodoService } from '../services/TodoService';
import { Todo } from '../models/Todo';

/**
 * WebView 提供者：负责渲染侧边栏面板并与 WebView 通信
 */
export class TodoWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'todoPanel.webview';

    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _todoService: TodoService
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

    public async refresh(): Promise<void> {
        await this._refreshTodos();
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
        }
        .todo-item:hover {
            background: var(--vscode-list-hoverBackground);
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
    </style>
</head>
<body>
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

        // 监听来自 Extension 的消息
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'loadTodos') {
                todos = message.todos;
                renderTodos();
            }
        });

        // 初始加载
        vscode.postMessage({ command: 'getTodos' });

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

        function renderTodos() {
            const list = document.getElementById('todoList');
            const empty = document.getElementById('emptyState');
            const stats = document.getElementById('stats');
            const statsText = document.getElementById('statsText');

            if (todos.length === 0) {
                list.innerHTML = '';
                empty.style.display = 'block';
                stats.style.display = 'none';
                return;
            }

            empty.style.display = 'none';
            stats.style.display = 'flex';
            const done = todos.filter(t => t.completed).length;
            statsText.textContent = done + ' / ' + todos.length + ' 已完成';

            list.innerHTML = todos.map(todo => 
                '<li class="todo-item ' + (todo.completed ? 'completed' : '') + '" id="todo-' + todo.id + '" data-id="' + todo.id + '" data-url="' + (todo.url ? escapeHtml(todo.url) : '') + '">' +
                    '<input type="checkbox" class="todo-checkbox" ' + (todo.completed ? 'checked' : '') + ' onchange="toggleTodo(\\'' + todo.id + '\\', ' + todo.completed + ')" />' +
                    '<div class="todo-content">' +
                        '<div class="todo-title">' + escapeHtml(todo.title) + '</div>' +
                        (todo.description ? '<div class="todo-desc">' + escapeHtml(todo.description) + '</div>' : '') +
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
