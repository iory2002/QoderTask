import type {
    BoardCard,
    BoardColumn,
    BoardNotice,
    BoardScope,
    BoardStatePayload,
    Freshness,
} from '../models/Board';
import { JiraService, type JiraIssue, type JiraSprint } from '../services/JiraService';
import { BoardPanel } from './BoardPanel';
import { ConfigError, describeError } from './errors';
import { readConfig } from './config';

const ISSUE_FIELDS = [
    'summary',
    'status',
    'issuetype',
    'priority',
    'updated',
    'customfield_10000',
    'customfield_10014',
    'parent',
    'comment',
    'assignee',
];

/**
 * 看板的内存态与轮询调度。
 *
 * 所有 HTTP 都在扩展进程；WebView 只消费 board:state。
 * 取数失败时保留上一份成功数据，只把 stale/error 翻上去。
 */
export class BoardState {
    private scope: BoardScope;
    private columns: BoardColumn[] = [];
    private cards: BoardCard[] = [];
    private sprint: JiraSprint | null = null;
    private rankField = 'customfield_10005';
    private freshness: Freshness = { lastSuccessAt: null, stale: false, error: null, loading: false };
    private notices: BoardNotice[] = [];
    private pendingKeys: string[] = [];
    private lastPublishedRevision = '';
    private inFlight = false;
    private disposed = false;
    /** epic key → 标题，Epic chip 显示用；很少变，跨轮次缓存 */
    private readonly epicLabels = new Map<string, string>();

    private readonly jira = new JiraService();

    constructor() {
        const config = readConfig();
        this.scope = { projects: config.projects, onlyMine: config.onlyMineByDefault };
    }

    public getScope(): BoardScope {
        return this.scope;
    }

    public setScope(scope: BoardScope): void {
        const config = readConfig();
        const allowed = new Set(config.projects);
        this.scope = {
            projects: (scope.projects ?? []).filter((project) => allowed.has(project)),
            onlyMine: scope.onlyMine !== false,
        };
    }

    /** 上一轮没回来就不发下一轮 */
    public async refresh(_force: boolean): Promise<void> {
        if (this.inFlight || this.disposed) {
            return;
        }
        this.inFlight = true;
        this.freshness = { ...this.freshness, loading: true };
        try {
            await this.load();
        } finally {
            this.inFlight = false;
            this.freshness = { ...this.freshness, loading: false };
            this.publish();
        }
    }

    public dispose(): void {
        this.disposed = true;
    }

    private async load(): Promise<void> {
        try {
            if (!this.jira.isConfigured()) {
                throw new ConfigError(
                    '未找到 Jira 配置，看板无法取数',
                    '在 ~/.scrumbuddy/config.json 里补 jira.baseUrl / jira.username / jira.password'
                );
            }

            const config = readConfig();
            const boardConfig = await this.jira.getBoardConfig(config.boardId);
            this.columns = boardConfig.columns;
            this.rankField = boardConfig.rankField;
            this.sprint = await this.jira.getActiveSprint(config.boardId);

            this.cards = this.sprint ? await this.fetchCards(this.sprint) : [];

            console.log(
                `[jira-board] board ${config.boardId} 列定义：` +
                    this.columns.map((column) => `${column.name}(${column.statusIds.join(',')})`).join(' / ') +
                    `，rank=${this.rankField}，sprint=${this.sprint?.name ?? '无'}，卡片=${this.cards.length}`
            );

            this.freshness = { lastSuccessAt: Date.now(), stale: false, error: null, loading: true };
            this.notices = this.buildNotices();
        } catch (error) {
            const described = describeError(error);
            this.freshness = {
                ...this.freshness,
                stale: this.freshness.lastSuccessAt !== null,
                error: described.message,
                loading: true,
            };
            this.notices = [
                { level: 'error', message: described.message, hint: described.hint },
                ...this.buildNotices(),
            ];
        }
    }

    private async fetchCards(sprint: JiraSprint): Promise<BoardCard[]> {
        const config = readConfig();
        if (config.projects.length === 0) {
            return [];
        }

        const jql = this.buildJql(sprint, config.projects);
        const fields = [...ISSUE_FIELDS, this.rankField];
        const result = await this.jira.search(jql, fields);
        const epics = await this.resolveEpicLabels(result.issues);

        const cards = result.issues
            .filter((issue) => (issue.fields.issuetype?.name ?? '') !== 'Epic')
            .map((issue) => this.toCard(issue, epics));

        return cards.sort((left, right) => {
            if (left.rank === right.rank) {
                return left.key.localeCompare(right.key);
            }
            if (!left.rank) {
                return 1;
            }
            if (!right.rank) {
                return -1;
            }
            return left.rank < right.rank ? -1 : 1;
        });
    }

    private buildJql(sprint: JiraSprint, projects: string[]): string {
        const clauses = [
            `sprint = ${sprint.id}`,
            `project IN (${projects.join(', ')})`,
            'issuetype != Epic',
        ];
        if (this.scope.onlyMine) {
            clauses.push('assignee = currentUser()');
        }
        return `${clauses.join(' AND ')} ORDER BY Rank ASC`;
    }

    /** Epic Link 是自定义字段（本环境 10000，兜底 10014），值为 key 字符串 */
    private epicKeyOf(issue: JiraIssue): string | null {
        const raw = issue.fields.customfield_10000 ?? issue.fields.customfield_10014;
        if (!raw) {
            return null;
        }
        if (typeof raw === 'string') {
            return raw;
        }
        if (typeof raw === 'object' && typeof raw.key === 'string') {
            return raw.key;
        }
        return null;
    }

    /** 一次批量查回 epic 标题，缺失的退化为 key */
    private async resolveEpicLabels(issues: JiraIssue[]): Promise<Map<string, string>> {
        const keys = new Set<string>();
        for (const issue of issues) {
            const key = this.epicKeyOf(issue);
            if (key && !this.epicLabels.has(key)) {
                keys.add(key);
            }
        }
        if (keys.size > 0) {
            const list = [...keys].slice(0, 50);
            try {
                const result = await this.jira.search(`key IN (${list.join(', ')})`, ['summary'], list.length);
                for (const epic of result.issues) {
                    this.epicLabels.set(epic.key, epic.fields.summary ?? epic.key);
                }
            } catch (error) {
                console.warn('[jira-board] epic 标题拉取失败，退回显示 key', error);
            }
        }
        return this.epicLabels;
    }

    private toCard(issue: JiraIssue, epics: Map<string, string>): BoardCard {
        const fields = issue.fields;
        const statusId = String(fields.status?.id ?? '');
        const column = this.columns.find((candidate) => candidate.statusIds.includes(statusId));
        const epicKey = this.epicKeyOf(issue);
        const issueType = fields.issuetype?.name ?? 'Task';
        const project = issue.key.split('-')[0];

        return {
            key: issue.key,
            project,
            summary: fields.summary ?? '',
            issueType,
            priority: fields.priority?.name ?? null,
            statusId,
            columnName: column?.name ?? '',
            epicKey,
            epicLabel: epicKey ? epics.get(epicKey) ?? epicKey : null,
            rank: String(fields[this.rankField] ?? ''),
            assignee: fields.assignee?.displayName ?? null,
            isSubtask: fields.issuetype?.subtask === true || issueType.toLowerCase() === 'sub-task',
            parentKey: fields.parent?.key,
            commentCount: fields.comment?.total ?? 0,
            stage: null,
            buildFailed: false,
            buildChannel: 'none',
            mrs: [],
            evidence: [],
            url: this.jira.browseUrl(issue.key),
        };
    }

    private buildNotices(): BoardNotice[] {
        const config = readConfig();
        const notices: BoardNotice[] = [];

        if (config.projects.length === 0) {
            notices.push({
                level: 'warn',
                message: '项目白名单为空，看板不会显示任何卡片',
                hint: '设置 todoPanel.projects',
            });
        }
        if (!this.sprint) {
            notices.push({
                level: 'warn',
                message: '没有找到活跃 sprint，看板暂时为空',
                hint: `检查 todoPanel.boardId（当前 ${config.boardId}）在 Jira 上是否有进行中的 sprint`,
            });
        }
        if (config.repos.length === 0) {
            notices.push({
                level: 'info',
                message: '没有配置仓库映射，所有卡片都不显示交付阶段',
                hint: '设置 todoPanel.repos 才能追踪 GitLab / Jenkins',
            });
        }
        return notices;
    }

    private publish(): void {
        if (this.disposed) {
            return;
        }
        const payload = this.buildPayload();
        if (payload.revision === this.lastPublishedRevision) {
            return;
        }
        this.lastPublishedRevision = payload.revision;
        BoardPanel.post({ type: 'board:state', payload });
    }

    private buildPayload(): BoardStatePayload {
        const config = readConfig();
        const signature = JSON.stringify({
            scope: this.scope,
            columns: this.columns,
            cards: this.cards,
            sprint: this.sprint?.id ?? null,
            notices: this.notices,
            stale: this.freshness.stale,
            error: this.freshness.error,
            pending: this.pendingKeys,
        });

        return {
            revision: fingerprint(signature),
            columns: this.columns,
            cards: this.cards,
            scope: this.scope,
            projectOptions: config.projects,
            freshness: this.freshness,
            notices: this.notices,
            unmappedCount: this.unmappedCount(),
            sprintName: this.sprint?.name ?? null,
            pendingKeys: this.pendingKeys,
        };
    }

    /** 落在 board 列之外的 issue：有卡片但状态不属于任何列 */
    private unmappedCount(): number {
        const mapped = new Set(this.columns.flatMap((column) => column.statusIds));
        return this.cards.filter((card) => !mapped.has(card.statusId)).length;
    }
}

/** 数据指纹：WebView 用它判断要不要重绘 */
export function fingerprint(input: string): string {
    let hash = 5381;
    for (let index = 0; index < input.length; index += 1) {
        hash = ((hash << 5) + hash + input.charCodeAt(index)) | 0;
    }
    return (hash >>> 0).toString(36);
}
