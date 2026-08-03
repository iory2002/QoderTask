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
exports.LocalFileTodoService = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * 基于本地 JSON 文件的 TodoService 实现
 * 用于 demo 和开发测试，后续可替换为远程 API 实现
 */
class LocalFileTodoService {
    constructor(storagePath) {
        this.filePath = path.join(storagePath, '.todo-data.json');
        this.ensureFileExists();
    }
    ensureFileExists() {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (!fs.existsSync(this.filePath)) {
            fs.writeFileSync(this.filePath, JSON.stringify([], null, 2), 'utf-8');
        }
    }
    readTodos() {
        const content = fs.readFileSync(this.filePath, 'utf-8');
        return JSON.parse(content);
    }
    writeTodos(todos) {
        fs.writeFileSync(this.filePath, JSON.stringify(todos, null, 2), 'utf-8');
    }
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
    }
    async getAll() {
        return this.readTodos();
    }
    async create(input) {
        const todos = this.readTodos();
        const now = new Date().toISOString();
        const newTodo = {
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
    async update(id, changes) {
        const todos = this.readTodos();
        const index = todos.findIndex(t => t.id === id);
        if (index === -1) {
            throw new Error(`Todo with id ${id} not found`);
        }
        const updated = {
            ...todos[index],
            ...changes,
            updatedAt: new Date().toISOString(),
        };
        todos[index] = updated;
        this.writeTodos(todos);
        return updated;
    }
    async delete(id) {
        const todos = this.readTodos();
        const filtered = todos.filter(t => t.id !== id);
        this.writeTodos(filtered);
    }
}
exports.LocalFileTodoService = LocalFileTodoService;
//# sourceMappingURL=LocalFileTodoService.js.map