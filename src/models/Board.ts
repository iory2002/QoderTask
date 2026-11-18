/**
 * 扩展与 WebView 之间共享的纯数据类型。
 * 这里不允许出现 vscode / node 依赖：WebView 侧也会 import type 这份文件。
 */

/** 交付阶段。null 表示该项目不做阶段追踪（无 repo 条目）。 */
export type Stage = 'none' | 'mr' | 'approved' | 'merged' | 'built' | 'unknown';

/**
 * 「交付阶段」视图筛选的选项 id。
 *
 * 前六个就是卡片上的阶段徽章；另外三个是徽章的特殊情况：
 * - rework：Jira 已退回开发（返工中），本轮从「未提交」重新起算
 * - failed：构建失败徽章（与阶段徽章同时出现，不是互斥的第七个阶段）
 * - nobadge：卡片根本没有徽章（项目未配 repo，或 Task / Sub-task 没有 MR）
 */
export type StageFilterId = Stage | 'rework' | 'failed' | 'nobadge';

/** 卡片密度：详细 = 现在的完整卡片；精简 = 只留 key 与阶段徽章那一行 */
export type CardDensity = 'detailed' | 'compact';

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
    /** 靠什么关联到这张卡：标题 > 描述 > 分支名 > 提交标题（最后的兜底） */
    matchedBy: 'title' | 'description' | 'branch' | 'commit';
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
    /** Jenkins 的 duration（毫秒）；进行中或缺失为 undefined，结束时间靠它算 */
    durationMs?: number;
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
    /**
     * Jira 状态已退回开发，本轮从零起算。
     * true 且 stage 为 none 时卡片显示「返工中」，不显示上一轮的「已构建」。
     */
    rework?: boolean;
    buildChannel: BuildChannel;
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

/** 视图开关（纯展示，不参与取数与计数） */
export interface BoardView {
    density: CardDensity;
    /**
     * 勾选要看的阶段徽章，全选 = 不过滤。
     * 与隐藏列一样只影响渲染：cards 仍是全量，角标与各类计数都不看它。
     */
    stages: StageFilterId[];
}

/** 运行能力：决定前端哪些信息根本不该出现，而不是取数失败 */
export interface BoardCapabilities {
    /** 没有 GitLab 凭据时，阶段徽章恒为「无法判定」，两种密度都不显示 */
    gitlab: boolean;
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
    /**
     * 被 pcBoard.hiddenColumns 隐藏的列 id。
     * 只是渲染开关：cards 仍是全量，角标与各类计数都不受它影响。
     */
    hiddenColumnIds: string[];
    cards: BoardCard[];
    scope: BoardScope;
    /** 卡片密度：全局视图偏好，改完立刻重发一帧 */
    view: BoardView;
    capabilities: BoardCapabilities;
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

/**
 * WebView → 扩展。除了「指派给我」，看板是只读的：改状态一律到 Jira 网页里做
 */
export type WebviewRequest =
    | { type: 'board:ready'; requestId?: string }
    | { type: 'board:refresh'; requestId?: string; payload?: { force?: boolean } }
    | { type: 'board:setScope'; requestId?: string; payload: BoardScope }
    | { type: 'board:setDensity'; requestId?: string; payload: { density: CardDensity } }
    | { type: 'board:setStages'; requestId?: string; payload: { stages: StageFilterId[] } }
    | { type: 'board:setVisibleColumns'; requestId?: string; payload: { visibleColumnIds: string[] } }
    | { type: 'card:openJira'; requestId?: string; payload: { key: string } }
    | { type: 'card:assignToMe'; requestId?: string; payload: { key: string } }
    | { type: 'board:openExternal'; requestId?: string; payload: { url: string } };

/** 扩展 → WebView */
export type ExtensionResponse =
    | { type: 'board:state'; payload: BoardStatePayload }
    | { type: 'board:error'; requestId?: string; payload: { message: string } };
