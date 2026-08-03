import { Todo, CreateTodoInput, UpdateTodoInput } from '../models/Todo';

/**
 * 数据服务抽象接口
 * 实现此接口可对接不同的数据源（本地文件、REST API、GraphQL 等）
 */
export interface TodoService {
    /** 获取所有待办事项 */
    getAll(): Promise<Todo[]>;

    /** 创建新的待办事项 */
    create(input: CreateTodoInput): Promise<Todo>;

    /** 更新待办事项 */
    update(id: string, changes: UpdateTodoInput): Promise<Todo>;

    /** 删除待办事项 */
    delete(id: string): Promise<void>;
}
