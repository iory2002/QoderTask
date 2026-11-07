import * as vscode from 'vscode';

/** 一个 Jira 项目 → 代码托管 / 构建 的映射条目 */
export interface RepoConfig {
    jiraProjects: string[];
    /** GitLab 项目路径或数值 id */
    gitlabProject: string;
    /** 只有合入该分支的 MR 才算交付 */
    targetBranch: string;
    /** null = 没有构建通道，阶段只到「已合入」 */
    jenkinsJobPath: string | null;
}

export interface BoardConfig {
    boardId: number;
    projects: string[];
    onlyMineByDefault: boolean;
    pollIntervalSec: number;
    repos: RepoConfig[];
}

const DEFAULTS: BoardConfig = {
    boardId: 23,
    projects: ['MAGR3', 'NEX', 'NEX2', 'IB'],
    onlyMineByDefault: true,
    pollIntervalSec: 45,
    repos: [],
};

/** 每次调用都重新读设置：用户改完配置不必重载窗口 */
export function readConfig(): BoardConfig {
    const section = vscode.workspace.getConfiguration('todoPanel');

    const projects = (section.get<string[]>('projects') ?? DEFAULTS.projects)
        .map((project) => project.trim().toUpperCase())
        .filter(Boolean);

    const repos = (section.get<RepoConfig[]>('repos') ?? [])
        .filter((repo) => repo && typeof repo.gitlabProject === 'string' && typeof repo.targetBranch === 'string')
        .map((repo) => ({
            jiraProjects: (repo.jiraProjects ?? []).map((project) => project.trim().toUpperCase()),
            gitlabProject: repo.gitlabProject,
            targetBranch: repo.targetBranch,
            jenkinsJobPath: repo.jenkinsJobPath ?? null,
        }));

    return {
        boardId: section.get<number>('boardId') ?? DEFAULTS.boardId,
        projects,
        onlyMineByDefault: section.get<boolean>('onlyMineByDefault') ?? DEFAULTS.onlyMineByDefault,
        pollIntervalSec: Math.min(60, Math.max(30, section.get<number>('pollIntervalSec') ?? DEFAULTS.pollIntervalSec)),
        repos,
    };
}

/** 某个 Jira 项目对应的 repo 条目；没有条目 = 该项目不做阶段追踪 */
export function repoForProject(config: BoardConfig, project: string): RepoConfig | undefined {
    return config.repos.find((repo) => repo.jiraProjects.includes(project));
}
