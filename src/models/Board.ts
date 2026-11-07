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
    columnName: string;
    epicKey: string | null;
    epicLabel: string | null;
    /** LexoRank，字典序即 Jira 看板顺序 */
    rank: string;
    assignee: string | null;
    isSubtask: boolean;
    parentKey?: string;
    commentCount: number;
    /** null = 该项目不追踪阶段，不出徽章 */
    stage: Stage | null;
    buildFailed: boolean;
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
    /** 写入中的卡片 key，轮询不得覆盖 */
    pendingKeys: string[];
}

export interface ColumnStatusRef {
    id: string;
    name: string;
}

/** 一次 workflow transition 的可用目标 */
export interface TransitionOption {
    id: string;
    name: string;
    toStatusId: string;
    toStatusName: string;
}

export type FieldKind = 'text' | 'textarea' | 'select' | 'multiselect' | 'user' | 'unsupported';

export interface FieldOption {
    id: string;
    label: string;
}

/**
 * 表单字段。value 是按 issue 当前字段预填的展示值；
 * raw 是可直接回传 Jira 的原始形状（未改动时用）。
 */
export interface TransitionField {
    id: string;
    name: string;
    required: boolean;
    kind: FieldKind;
    /** 不支持的原始 schema 类型，用于在表单顶部说明原因 */
    schemaType: string;
    options: FieldOption[];
    value: string | string[] | null;
    raw: unknown;
}

export interface TransitionForm {
    key: string;
    /** 目标列 */
    columnId: string;
    columnName: string;
    transition: TransitionOption;
    fields: TransitionField[];
    /** 无法渲染的字段名，非空时禁用提交 */
    unsupportedFields: string[];
    /** 字段类型不支持时的兜底入口 */
    jiraUrl: string;
}

export interface TransitionWriteRequest {
    key: string;
    transitionId: string;
    fields: Record<string, unknown>;
}

export interface TransitionResult {
    key: string;
    ok: boolean;
    /** 整体失败原因（人话） */
    error?: string;
    /** 字段级错误：fieldId → 说明；直接回填到对应控件 */
    fieldErrors?: Record<string, string>;
}

/** 单列的拖放合法性：拖拽开始时一次算完，拖到上面之前就能看出能不能放 */
export interface ColumnDropRule {
    columnId: string;
    legal: boolean;
    transitionId?: string;
    transitionName?: string;
    /** 不能放的原因（回退 / 没有直达动作 / 已在目标列） */
    reason?: string;
    /** 该 transition 需要填的表单（08 起使用） */
    form?: TransitionForm;
}

export interface TransitionAvailability {
    key: string;
    jiraUrl: string;
    /** 卡片当前所在列，null = 列外状态 */
    currentColumnId: string | null;
    drops: ColumnDropRule[];
}

export interface WebviewMessage {
    type: string;
    requestId?: string;
    payload?: unknown;
}

/** WebView → 扩展 */
export type WebviewRequest =
    | { type: 'board:ready'; requestId?: string }
    | { type: 'board:refresh'; requestId?: string; payload?: { force?: boolean } }
    | { type: 'board:setScope'; requestId?: string; payload: BoardScope }
    | { type: 'card:fetchTransitions'; requestId?: string; payload: { key: string } }
    | { type: 'card:transition'; requestId?: string; payload: TransitionWriteRequest }
    | { type: 'card:openJira'; requestId?: string; payload: { key: string } }
    | { type: 'board:openExternal'; requestId?: string; payload: { url: string } };

/** 扩展 → WebView */
export type ExtensionResponse =
    | { type: 'board:state'; payload: BoardStatePayload }
    | { type: 'card:transitions'; requestId?: string; payload: TransitionAvailability }
    | { type: 'card:transitionForm'; requestId?: string; payload: TransitionForm }
    | { type: 'card:transitionResult'; requestId?: string; payload: TransitionResult }
    | { type: 'board:error'; requestId?: string; payload: { message: string } };
