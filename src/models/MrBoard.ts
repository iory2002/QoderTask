/**
 * MR Board 的纯数据类型。扩展与 WebView 共用。
 *
 * 不复用 Board.ts 的 MrFact：那个类型表达「某 issue 的交付证据」，
 * 缺少 author / reviewers / draft / createdAt，塞进来只会让两个语义互相污染。
 */
import type { BoardNotice, Freshness } from './Board';

/** 审查状态。unknown = 审批取数失败，绝不等价于 unreviewed。 */
export type MrReviewState = 'awaiting-me' | 'unreviewed' | 'reviewed' | 'unknown';

export interface MrPerson {
    id: number;
    name: string;
    username: string;
}

export interface MrCard {
    iid: number;
    /** 多仓库时用于区分同号 MR（两个仓库都可能有 !1234） */
    projectPath: string;
    title: string;
    url: string;
    sourceBranch: string;
    targetBranch: string;
    author: MrPerson;
    approvedBy: MrPerson[];
    approvalsLeft: number | null;
    /** false = /approvals 取数失败，此时不许推断「未审」 */
    approvalsKnown: boolean;
    /**
     * 合并冲突。null = 列表接口没给这个字段（未知），绝不等价于 false。
     * 有冲突要上卡面：它是唯一「不点开也知道必须动手」的信号。
     */
    hasConflicts: boolean | null;
    /**
     * 阻塞性讨论是否全部解决。null = 未知；false = 还有未解决讨论。
     * 只进详情：多数时候是在等作者回复，上卡面会变成刷不完的红点。
     */
    blockingDiscussionsResolved: boolean | null;
    createdAt: string;
    updatedAt: string;
    reviewState: MrReviewState;
    jiraKeys: string[];
}

export type MrColumnId = 'review-queue' | 'my-mrs';

export interface MrBoardScopeEntry {
    gitlabProject: string;
    targetBranch: string;
}

export interface MrBoardPayload {
    /** 数据指纹：未变化时 WebView 不重绘 */
    revision: string;
    loading: boolean;
    reviewQueue: MrCard[];
    myMrs: MrCard[];
    /** 已关闭未合入的 MR 数：不进列，只在顶栏提示 */
    closedCount: number;
    scope: MrBoardScopeEntry[];
    freshness: Freshness;
    notices: BoardNotice[];
}

export interface MrWebviewMessage {
    type: string;
    requestId?: string;
    payload?: unknown;
}

export type MrWebviewRequest =
    | { type: 'mrBoard:ready'; requestId?: string }
    | { type: 'mrBoard:refresh'; requestId?: string; payload?: { force?: boolean } }
    | { type: 'mr:openExternal'; requestId?: string; payload: { url: string } }
    | { type: 'mr:openJira'; requestId?: string; payload: { key: string } }
    | { type: 'mr:review'; requestId?: string; payload: { iid: number; projectPath: string } }
    | { type: 'mr:copyLink'; requestId?: string; payload: { url: string } };

export type MrExtensionResponse =
    | { type: 'mrBoard:state'; payload: MrBoardPayload }
    | { type: 'mrBoard:error'; requestId?: string; payload: { message: string } };
