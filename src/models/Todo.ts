export interface Todo {
    id: string;
    title: string;
    description: string;
    completed: boolean;
    createdAt: string;
    updatedAt: string;
    /** 外部链接（如 JIRA 任务地址），仅存储不显示 */
    url?: string;
    /** Jira issue key（如 NEX2-373），用于同步时匹配 */
    jiraKey?: string;
    /** GitLab MR IID（如 42），用于同步时匹配 */
    gitlabMrId?: string;
    /** Jira/GitLab 状态（如 Open, In Progress, Resolved） */
    status?: string;
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
