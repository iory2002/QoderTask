import type { BoardScope, BoardStatePayload } from '../models/Board';
import { readConfig } from './config';
import { BoardPanel } from './BoardPanel';

/**
 * 看板的内存态与轮询调度。
 *
 * 第一阶段只有骨架：范围来自配置，数据为空。
 * 后续每一层（列、卡片、阶段、构建）在这个类里补齐，WebView 始终只消费 board:state。
 */
export class BoardState {
    private scope: BoardScope;
    private lastPublishedRevision = '';
    private disposed = false;

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

    public async refresh(_force: boolean): Promise<void> {
        this.publish();
    }

    public dispose(): void {
        this.disposed = true;
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
        const signature = JSON.stringify({ scope: this.scope, projects: config.projects });

        return {
            revision: fingerprint(signature),
            columns: [],
            cards: [],
            scope: this.scope,
            projectOptions: config.projects,
            freshness: { lastSuccessAt: null, stale: false, error: null, loading: false },
            notices: [],
            unmappedCount: 0,
            sprintName: null,
            pendingKeys: [],
        };
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
