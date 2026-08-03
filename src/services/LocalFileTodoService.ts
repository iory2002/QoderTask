import * as fs from 'fs';
import * as path from 'path';
import { Todo, CreateTodoInput, UpdateTodoInput } from '../models/Todo';
import { TodoService } from './TodoService';

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
}
