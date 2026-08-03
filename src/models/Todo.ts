export interface Todo {
    id: string;
    title: string;
    description: string;
    completed: boolean;
    createdAt: string;
    updatedAt: string;
    /** 外部链接（如 JIRA 任务地址），仅存储不显示 */
    url?: string;
}

export interface CreateTodoInput {
    title: string;
    description: string;
    /** 外部链接（如 JIRA 任务地址） */
    url?: string;
}

export interface UpdateTodoInput {
    title?: string;
    description?: string;
    completed?: boolean;
}
