/**
 * 扩展与 WebView 之间共享的纯数据类型。
 * 这里不允许出现 vscode / node 依赖：WebView 侧也会 import type 这份文件。
 */

/** 交付阶段。null 表示该项目不做阶段追踪（无 repo 条目）。 */
export type Stage = 'none' | 'mr' | 'approved' | 'merged' | 'built' | 'unknown';

/** 一条来自 GitLab 的 MR 事实 */
export interface MrFact {
    iid: number;
    title: string;
    state: string;
    url: string;
    targetBranch: string;
    sourceBranch: string;
    /** 仅 opened 的 MR 会查 /approvals，merged/closed 恒为 false */
    approved: boolean;
    approvedBy: string[];
    approvalsLeft: number | null;
    /** false = /approvals 取数失败，此时「未批准」不可信，阶段只能判无法判定 */
    approvalsKnown: boolean;
    mergedAt?: string;
    /** 合入后的 merge commit：祖先判定的左边 */
    mergeCommitSha?: string;
    /** 靠什么关联到这张卡：标题 > 描述 > 分支名 */
    matchedBy: 'title' | 'description' | 'branch';
    /** 卡片上展示的那一个（阶段最高；同阶段 merged_at 最新） */
    isCardMr: boolean;
}

/** 一条 Jenkins 构建事实 */
export interface BuildFact {
    number: number;
    /** null = 进行中，既不算成功也不算失败 */
    result: string | null;
    /** epoch ms */
    timestamp: number;
    branch: string;
    url: string;
    /** 该构建 checkout 的 commit；拿不到时祖先判定只能退回时间窗 */
    sha?: string;
}

/** 构建通道能力：full=可判到「已构建」；merge-only=只到「已合入」；none=不追踪 */
export type BuildChannel = 'full' | 'merge-only' | 'none';

export interface BoardColumn {
    id: string;
    name: string;
    statusIds: string[];
}

export interface BoardCard {
    key: string;
    project: string;
    summary: string;
    issueType: string;
    priority: string | null;
    statusId: string;
    /** Jira 状态名（如 In Code Review）。角标按状态名归类，列名不可靠 */
    statusName: string;
    columnName: string;
    epicKey: string | null;
    epicLabel: string | null;
    /** LexoRank，字典序即 Jira 看板顺序 */
    rank: string;
    assignee: string | null;
    /** 是否指派给当前用户（服务端算好，前端只做视图过滤） */
    isMine: boolean;
    /** 是否来自 extraIssueKeys 的钉住名单（dev 模式） */
    pinned: boolean;
    isSubtask: boolean;
    parentKey?: string;
    commentCount: number;
    /** Jira 的 updated 字段，入库前已解析成 epoch ms；缺失为 null */
    updatedAtEpoch: number | null;
    /** null = 该项目不追踪阶段，不出徽章 */
    stage: Stage | null;
    /**
     * 该类型是否算「写代码的工作」（Story / Bug）。
     * false 时，若没有关联到 MR，不显示「未提交」——Task / Sub-task 本来就不产出 MR，
     * 报「未提交」等于噪声；一旦真有 MR，阶段照常参与展示。
     * 缺省（undefined）按 true 处理。
     */
    codeWork?: boolean;
    buildFailed: boolean;
    buildChannel: BuildChannel;
    /**
     * 最早一次合入距今的天数；未合入 / 取数失败 / 未到阈值都是 null。
     * 只在详情里用来写「合入后 N 天未推进」，不占卡面。
     */
    mergedDaysAgo: number | null;
    /** 该 key 关联到的全部 MR，按阶段降序 */
    mrs: MrFact[];
    build?: BuildFact;
    /** 人话版推导依据，详情浮层直接逐条展示 */
    evidence: string[];
    url: string;
}

export interface BoardScope {
    projects: string[];
    onlyMine: boolean;
}

export interface Freshness {
    /** 上一次成功取数的时间戳 */
    lastSuccessAt: number | null;
    /** 当前展示的数据是否可能过期 */
    stale: boolean;
    /** 失败原因，人类可读 */
    error: string | null;
}
export type NoticeLevel = 'info' | 'warn' | 'error';

export interface BoardNotice {
    level: NoticeLevel;
    message: string;
    /** 指向具体配置位置，便于用户自己修 */
    hint?: string;
}

export interface BoardStatePayload {
    /** 数据指纹：未变化时 WebView 不重绘 */
    revision: string;
    /** 首次加载尚未完成：为 true 时前端应显示骨架屏，不要把空列当成「读不到」 */
    loading: boolean;
    columns: BoardColumn[];
    cards: BoardCard[];
    scope: BoardScope;
    /** 项目过滤候选（配置白名单） */
    projectOptions: string[];
    freshness: Freshness;
    notices: BoardNotice[];
    /** 落在 board 列之外的 issue 数 */
    unmappedCount: number;
    /** 当前活跃 sprint 的名称，null = 没找到 */
    sprintName: string | null;
}

export interface WebviewMessage {
    type: string;
    requestId?: string;
    payload?: unknown;
}

/** WebView → 扩展。看板是只读的：改状态一律到 Jira 网页里做 */
export type WebviewRequest =
    | { type: 'board:ready'; requestId?: string }
    | { type: 'board:refresh'; requestId?: string; payload?: { force?: boolean } }
    | { type: 'board:setScope'; requestId?: string; payload: BoardScope }
    | { type: 'card:openJira'; requestId?: string; payload: { key: string } }
    | { type: 'board:openExternal'; requestId?: string; payload: { url: string } };

/** 扩展 → WebView */
export type ExtensionResponse =
    | { type: 'board:state'; payload: BoardStatePayload }
    | { type: 'board:error'; requestId?: string; payload: { message: string } };
