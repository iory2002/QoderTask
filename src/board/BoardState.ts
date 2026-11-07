import type {
    BoardColumn,
    BoardNotice,
    BoardScope,
    BoardStatePayload,
    BoardCard,
    Freshness,
} from '../models/Board';
import { JiraService, type JiraSprint } from '../services/JiraService';
import { BoardPanel } from './BoardPanel';
import { ConfigError, describeError } from './errors';
import { readConfig } from './config';

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
    private freshness: Freshness = { lastSuccessAt: null, stale: false, error: null, loading: false };
    private notices: BoardNotice[] = [];
    private pendingKeys: string[] = [];
    private lastPublishedRevision = '';
    private inFlight = false;
    private disposed = false;

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
        const config = readConfig();
        try {
            if (!this.jira.isConfigured()) {
                throw new ConfigError(
                    '未找到 Jira 配置，看板无法取数',
                    '在 ~/.scrumbuddy/config.json 里补 jira.baseUrl / jira.username / jira.password'
                );
            }

            const boardConfig = await this.jira.getBoardConfig(config.boardId);
            this.columns = boardConfig.columns;
            this.sprint = await this.jira.getActiveSprint(config.boardId);
            this.cards = [];
            console.log(
                `[jira-board] board ${config.boardId} 列定义：` +
                    this.columns.map((column) => `${column.name}(${column.statusIds.join(',')})`).join(' / ') +
                    `，rank=${boardConfig.rankField}，sprint=${this.sprint?.name ?? '无'}`
            );

            this.freshness = {
                lastSuccessAt: Date.now(),
                stale: false,
                error: null,
                loading: true,
            };
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
