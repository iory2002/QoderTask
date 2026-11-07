import * as fs from 'fs';
import * as path from 'path';
import { Todo, CreateTodoInput, UpdateTodoInput } from '../models/Todo';
import { TodoService } from './TodoService';
import { JiraSyncItem } from './JiraService';
import { GitLabSyncItem } from './GitLabService';

/**
 * 基于本地 JSON 文件的 TodoService 实现
 * 用于 demo 和开发测试，后续可替换为远程 API 实现
 */
export class LocalFileTodoService implements TodoService {
    private filePath: string;

    constructor(storagePath: string) {
        this.filePath = path.join(storagePath, '.todo-data.json');
        this.ensureFileExists();
    }

    private ensureFileExists(): void {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (!fs.existsSync(this.filePath)) {
            fs.writeFileSync(this.filePath, JSON.stringify([], null, 2), 'utf-8');
        }
    }

    private readTodos(): Todo[] {
        const content = fs.readFileSync(this.filePath, 'utf-8');
        return JSON.parse(content) as Todo[];
    }

    private writeTodos(todos: Todo[]): void {
        fs.writeFileSync(this.filePath, JSON.stringify(todos, null, 2), 'utf-8');
    }

    private generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
    }

    async getAll(): Promise<Todo[]> {
        return this.readTodos();
    }

    async create(input: CreateTodoInput): Promise<Todo> {
        const todos = this.readTodos();
        const now = new Date().toISOString();
        const newTodo: Todo = {
            id: this.generateId(),
            title: input.title,
            description: input.description,
            completed: false,
            createdAt: now,
            updatedAt: now,
        };
        if (input.url) {
            newTodo.url = input.url;
        }
        todos.push(newTodo);
        this.writeTodos(todos);
        return newTodo;
    }

    async update(id: string, changes: UpdateTodoInput): Promise<Todo> {
        const todos = this.readTodos();
        const index = todos.findIndex(t => t.id === id);
        if (index === -1) {
            throw new Error(`Todo with id ${id} not found`);
        }
        const updated: Todo = {
            ...todos[index],
            ...changes,
            updatedAt: new Date().toISOString(),
        };
        todos[index] = updated;
        this.writeTodos(todos);
        return updated;
    }

    async delete(id: string): Promise<void> {
        const todos = this.readTodos();
        const filtered = todos.filter(t => t.id !== id);
        this.writeTodos(filtered);
    }

    async reorder(orderedIds: string[]): Promise<Todo[]> {
        const todos = this.readTodos();
        const map = new Map(todos.map(t => [t.id, t]));
        const reordered: Todo[] = [];
        // 按新顺序排列
        for (const id of orderedIds) {
            const todo = map.get(id);
            if (todo) {
                reordered.push(todo);
                map.delete(id);
            }
        }
        // 不在新顺序中的项追加到末尾（安全兼容）
        for (const todo of map.values()) {
            reordered.push(todo);
        }
        this.writeTodos(reordered);
        return reordered;
    }

    async clearAll(): Promise<void> {
        this.writeTodos([]);
    }

    /**
     * 将 Jira 数据与现有待办合并：
     * - jiraKey 匹配的项：更新 title / description / url，保留 completed 状态
     * - jiraKey 不存在的项：新增
     * - 不再存在于最新 Jira 数据中的旧项：删除
     * - 无 jiraKey 的手动项 / GitLab MR 项：原样保留
     */
    async syncFromJira(jiraItems: JiraSyncItem[]): Promise<Todo[]> {
        // 客户端过滤：排除已完成状态的 issue（双保险，防止 JQL 未生效时混入）
        const doneStatuses = new Set(['resolved', 'closed', 'done']);
        const activeItems = jiraItems.filter(item => !doneStatuses.has(item.status.toLowerCase()));

        const todos = this.readTodos();
        const now = new Date().toISOString();
        const jiraKeySet = new Set(activeItems.map(item => item.jiraKey));

        // 1. 删除不再存在于最新 Jira 数据中的旧 Jira 项
        //    仅清理带 jiraKey 的项，不影响用户手动项和 GitLab MR 项
        const retained = todos.filter(t => !t.jiraKey || jiraKeySet.has(t.jiraKey));

        // 2. 更新已有的 Jira 项 / 新增不在列表中的 Jira 项
        for (const item of activeItems) {
            const existing = retained.find(t => t.jiraKey === item.jiraKey);
            if (existing) {
                // 更新标题、描述、链接、状态，但保留用户的 completed 状态
                existing.title = item.title;
                existing.description = item.description;
                existing.url = item.url;
                existing.status = item.status;
                existing.updatedAt = now;
            } else {
                // 新增 Jira 项
                const newTodo: Todo = {
                    id: Date.now().toString(36) + Math.random().toString(36).substring(2, 8),
                    title: item.title,
                    description: item.description,
                    completed: false,
                    createdAt: now,
                    updatedAt: now,
                    url: item.url,
                    jiraKey: item.jiraKey,
                    status: item.status,
                };
                retained.push(newTodo);
            }
        }

        this.writeTodos(retained);
        return retained;
    }

    /**
     * 清除所有用户手动创建的项（保留 Jira 和 GitLab 同步项）
     */
    async clearUserTodos(): Promise<Todo[]> {
        const todos = this.readTodos();
        const retained = todos.filter(t => t.jiraKey || t.gitlabMrId);
        this.writeTodos(retained);
        return retained;
    }

    /**
     * 将 GitLab MR 数据与现有待办合并：
     * - gitlabMrId 匹配的项：更新 title / description / url，保留 completed 状态
     * - gitlabMrId 不存在的项：新增
     * - 不再存在于最新 GitLab 数据中的旧 MR 项：删除
     * - 手动添加项 / Jira 项：原样保留
     */
    async syncFromGitLab(mrItems: GitLabSyncItem[]): Promise<Todo[]> {
        const todos = this.readTodos();
        const now = new Date().toISOString();
        const mrIdSet = new Set(mrItems.map(item => item.gitlabMrId));

        // 1. 删除不再存在于最新 GitLab 数据中的旧 MR 项
        //    仅清理带 gitlabMrId 的项，不影响用户手动项和 Jira 项
        const retained = todos.filter(t => !t.gitlabMrId || mrIdSet.has(t.gitlabMrId));

        // 2. 更新已有的 MR 项 / 新增不在列表中的 MR 项
        for (const item of mrItems) {
            const existing = retained.find(t => t.gitlabMrId === item.gitlabMrId);
            if (existing) {
                existing.title = item.title;
                existing.description = item.description;
                existing.url = item.url;
                existing.status = item.status;
                existing.updatedAt = now;
            } else {
                const newTodo: Todo = {
                    id: Date.now().toString(36) + Math.random().toString(36).substring(2, 8),
                    title: item.title,
                    description: item.description,
                    completed: false,
                    createdAt: now,
                    updatedAt: now,
                    url: item.url,
                    gitlabMrId: item.gitlabMrId,
                    status: item.status,
                };
                retained.push(newTodo);
            }
        }

        this.writeTodos(retained);
        return retained;
    }
}
