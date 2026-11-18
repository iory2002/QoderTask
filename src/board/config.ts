import * as vscode from 'vscode';

import { parseScopeLines, type MrScopeEntry } from '../services/MrScopeParser';

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
    /** 仅在 devMode 打开时生效的项目白名单 */
    projects: string[];
    /** dev 开关：打开后才会把 extraIssueKeys 里的 issue 钉进看板 */
    devMode: boolean;
    onlyMineByDefault: boolean;
    /** 只在看板上隐藏的列名：纯展示开关，不参与取数与计数 */
    hiddenColumns: string[];
    pollIntervalSec: number;
    /** 哪些 issue 类型需要看构建；其余类型（Task / Sub-task）阶段顶格在「已合入」 */
    buildCheckIssueTypes: string[];
    /** 算「已退回开发 / 返工」的 Jira 状态名：处于这些状态时本轮从「未提交」重新起算 */
    reworkStatuses: string[];
    /** 额外钉住的 issue key：仅在 devMode 打开时生效，用来单独盯一张还没进 sprint 的卡 */
    extraIssueKeys: string[];
    repos: RepoConfig[];
}

/** MR Board 的取数范围：一个仓库 + 一条目标分支 */
export type { MrScopeEntry } from '../services/MrScopeParser';

export interface MrBoardConfig {
    repos: MrScopeEntry[];
    /** `仓库@分支` 里解析失败的行：不静默丢弃 */
    invalidScopes: string[];
    pollIntervalSec: number;
}

/** 活动栏 Jira 图标上显示哪一个数字 */
export type JiraBadgeMode = 'development' | 'testing';

/** 活动栏 GitLab 图标上显示哪一个数字 */
export type MrBadgeMode = 'reviewQueue' | 'awaitingOthers';

export interface BadgeConfig {
    jira: {
        mode: JiraBadgeMode;
        /** 只统计指派给自己的 issue */
        onlyMine: boolean;
        /** 算「开发中未完成」的状态名 */
        developmentStatuses: string[];
        /** 算「测试中未完成」的状态名 */
        testingStatuses: string[];
        /** 面板不可见时的轮询间隔：角标要常驻，不能跟着面板一起停表 */
        pollIntervalSec: number;
    };
    gitlab: {
        mode: MrBadgeMode;
        pollIntervalSec: number;
    };
}

const MR_DEFAULTS: MrBoardConfig = {
    repos: [{ gitlabProject: 'ultrasoundgeneralimaging/gipc-app', targetBranch: 'nexus/dev/7.10.x' }],
    invalidScopes: [],
    pollIntervalSec: 60,
};

const DEFAULTS: BoardConfig = {
    boardId: 23,
    projects: ['NEX2'],
    devMode: false,
    onlyMineByDefault: true,
    hiddenColumns: [],
    pollIntervalSec: 60,
    buildCheckIssueTypes: ['Story', 'Bug', 'In-Sprint Bug'],
    reworkStatuses: ['In Progress', 'Reopened', 'In Rework', 'Test Failed'],
    extraIssueKeys: [],
    repos: [],
};

const BADGE_DEFAULTS: BadgeConfig = {
    jira: {
        mode: 'development',
        onlyMine: true,
        developmentStatuses: ['Open', 'In Progress', 'In review', 'In Code Review'],
        testingStatuses: ['In Test'],
        pollIntervalSec: 60,
    },
    gitlab: { mode: 'reviewQueue', pollIntervalSec: 60 },
};

const SECTION = 'pcBoard';
/** 改名前的前缀：老用户写在 settings.json 里的键继续有效 */
const LEGACY_SECTION = 'todoPanel';

/**
 * 读「用户显式写过」的值：先看新前缀 `pcBoard.*`，再回退旧前缀 `todoPanel.*`。
 *
 * 不能用 get()：它会返回 package.json 里的默认值，新键于是永远「有值」，
 * 老用户写在 todoPanel.* 下的配置就再也不会生效。
 */
function readExplicit<T>(key: string): T | undefined {
    const own = vscode.workspace.getConfiguration(SECTION).inspect<T>(key);
    const explicit = own?.workspaceFolderValue ?? own?.workspaceValue ?? own?.globalValue;
    if (explicit !== undefined) {
        return explicit;
    }
    const legacy = vscode.workspace.getConfiguration(LEGACY_SECTION).inspect<T>(key);
    return legacy?.workspaceFolderValue ?? legacy?.workspaceValue ?? legacy?.globalValue;
}

/**
 * 读「实际生效」的值：新前缀显式值 → 旧前缀显式值 → package.json 默认值 → 代码兜底。
 *
 * 少最后一步就会出事：`pcBoard.repos` 的默认值（NEX2 / NEX 两条映射）写在 package.json 里，
 * 只读显式值会让没配置过的用户拿到空数组，卡片全部丢掉交付阶段。
 */
function readValue<T>(key: string, fallback: T): T {
    const own = vscode.workspace.getConfiguration(SECTION).inspect<T>(key);
    const explicit = own?.workspaceFolderValue ?? own?.workspaceValue ?? own?.globalValue;
    if (explicit !== undefined) {
        return explicit;
    }
    const legacy = vscode.workspace.getConfiguration(LEGACY_SECTION).inspect<T>(key);
    const legacyValue = legacy?.workspaceFolderValue ?? legacy?.workspaceValue ?? legacy?.globalValue;
    if (legacyValue !== undefined) {
        return legacyValue;
    }
    return vscode.workspace.getConfiguration(SECTION).get<T>(key) ?? fallback;
}

function readStringList(key: string, fallback: string[], upper = false): string[] {
    const raw = readValue<string[]>(key, fallback);
    return raw
        .map((value) => (upper ? value.trim().toUpperCase() : value.trim()))
        .filter(Boolean);
}

/**
 * 把「要隐藏的列名」写回设置。看板「视图」菜单直接用它，不再要求用户手改 JSON。
 *
 * 打开工作区时写 Workspace（跟着仓库走，团队可共享）；单文件窗口没有
 * Workspace 层，退回 Global，否则 update 会直接报错。
 */
export function writeHiddenColumns(names: string[]): Thenable<void> {
    const target = vscode.workspace.workspaceFolders?.length
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
    return vscode.workspace.getConfiguration(SECTION).update('hiddenColumns', names, target);
}

/** 每次调用都重新读设置：用户改完配置不必重载窗口 */
export function readConfig(): BoardConfig {
    const projects = readStringList('projects', DEFAULTS.projects, true);

    const repos = readValue<RepoConfig[]>('repos', [])
        .filter((repo) => repo && typeof repo.gitlabProject === 'string' && typeof repo.targetBranch === 'string')
        .map((repo) => ({
            jiraProjects: (repo.jiraProjects ?? []).map((project) => project.trim().toUpperCase()),
            gitlabProject: repo.gitlabProject,
            targetBranch: repo.targetBranch,
            jenkinsJobPath: repo.jenkinsJobPath ?? null,
        }));

    const rawInterval = readValue<number>('pollIntervalSec', DEFAULTS.pollIntervalSec);

    return {
        boardId: readValue<number>('boardId', DEFAULTS.boardId),
        projects,
        devMode: readValue<boolean>('devMode', DEFAULTS.devMode),
        onlyMineByDefault: readValue<boolean>('onlyMineByDefault', DEFAULTS.onlyMineByDefault),
        hiddenColumns: readStringList('hiddenColumns', DEFAULTS.hiddenColumns),
        pollIntervalSec: Math.min(600, Math.max(30, rawInterval)),
        buildCheckIssueTypes: readStringList('buildCheckIssueTypes', DEFAULTS.buildCheckIssueTypes),
        reworkStatuses: readStringList('reworkStatuses', DEFAULTS.reworkStatuses),
        extraIssueKeys: readStringList('extraIssueKeys', DEFAULTS.extraIssueKeys, true),
        repos,
    };
}

/**
 * MR Board 的范围与节奏。独立于 pcBoard.repos：
 * 加一条 5.10.x 的 MR 范围，不应该顺带改变 Jira 看板的阶段判定。
 *
 * 范围优先读 `pcBoard.mrBoard.scopes`（字符串数组，Settings UI 可直接输入）；
 * 旧的 `mrBoard.repos`（对象数组）作为兼容回退。
 */
export function readMrConfig(): MrBoardConfig {
    const rawScopes = readExplicit<string[]>('mrBoard.scopes');
    let repos: MrScopeEntry[];
    let invalidScopes: string[] = [];

    if (rawScopes === undefined) {
        const legacy = readExplicit<MrScopeEntry[]>('mrBoard.repos');
        if (legacy === undefined) {
            repos = MR_DEFAULTS.repos;
        } else {
            repos = legacy
                .filter((repo) => repo && typeof repo.gitlabProject === 'string' && typeof repo.targetBranch === 'string')
                .map((repo) => ({
                    gitlabProject: repo.gitlabProject.trim(),
                    targetBranch: repo.targetBranch.trim(),
                }))
                .filter((repo) => !!repo.gitlabProject && !!repo.targetBranch);
        }
    } else {
        const parsed = parseScopeLines(rawScopes);
        repos = parsed.entries;
        invalidScopes = parsed.invalid;
    }

    const rawInterval = readValue<number>('mrBoard.pollIntervalSec', MR_DEFAULTS.pollIntervalSec);

    return {
        repos,
        invalidScopes,
        pollIntervalSec: Math.min(600, Math.max(30, rawInterval)),
    };
}

/**
 * 活动栏角标的口径与节奏。
 *
 * 一个活动栏图标只承载一个数字（ViewBadge 的 value 是单值），
 * 所以每种角标都有「主数字」与「副数字」：主数字上图标，两者都进侧边栏。
 */
export function readBadgeConfig(): BadgeConfig {
    const jiraMode: JiraBadgeMode =
        readValue<string>('badge.jira.mode', BADGE_DEFAULTS.jira.mode) === 'testing' ? 'testing' : 'development';
    const mrMode: MrBadgeMode =
        readValue<string>('badge.gitlab.mode', BADGE_DEFAULTS.gitlab.mode) === 'awaitingOthers'
            ? 'awaitingOthers'
            : 'reviewQueue';

    return {
        jira: {
            mode: jiraMode,
            onlyMine: readValue<boolean>('badge.jira.onlyMine', BADGE_DEFAULTS.jira.onlyMine),
            developmentStatuses: readStringList(
                'badge.jira.developmentStatuses',
                BADGE_DEFAULTS.jira.developmentStatuses
            ),
            testingStatuses: readStringList('badge.jira.testingStatuses', BADGE_DEFAULTS.jira.testingStatuses),
            pollIntervalSec: clampInterval(
                readValue<number>('badge.jira.pollIntervalSec', BADGE_DEFAULTS.jira.pollIntervalSec)
            ),
        },
        gitlab: {
            mode: mrMode,
            pollIntervalSec: clampInterval(
                readValue<number>('badge.gitlab.pollIntervalSec', BADGE_DEFAULTS.gitlab.pollIntervalSec)
            ),
        },
    };
}

function clampInterval(seconds: number): number {
    return Math.min(1800, Math.max(30, seconds));
}
