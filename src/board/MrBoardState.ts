import * as crypto from 'crypto';

import type { BoardNotice, Freshness } from '../models/Board';
import type { MrBoardPayload, MrCard } from '../models/MrBoard';
import { GitLabService, clearGitLabCaches, type GitLabApprovals, type GitLabMrRow, type GitLabUser } from '../services/GitLabService';
import { classify, mrKey, type MrCandidate } from '../services/MrBoardResolver';
import { countMrBadges, type BadgeCounts } from '../services/BadgeCounter';
import { epochOf } from '../services/time';
import { readBadgeConfig, readConfig, readMrConfig } from './config';
import { ConfigError, describeError } from './errors';
import { FactStore, FOLLOW_POLL_MS, FRESHNESS_MS, type ApprovalRow, type MrRow } from './FactStore';
import { approvalsFromStore, mrCandidatesFromStore, restoredFreshness } from './Restore';
import { revisionOf } from './fingerprint';
import { MrBoardPanel } from './MrBoardPanel';

/**
 * MR Board 的内存态与轮询。
 *
 * 与 Jira 看板同一套骨架（指纹抑制重绘、可见性停表、失败保留旧数据），
 * 但取数语义完全不同：这里按 reviewer / author 两条腿拉，再用分类器切两列。
 */
export class MrBoardState {
    private reviewQueue: MrCard[] = [];
    private myMrs: MrCard[] = [];
    private closedCount = 0;
    private freshness: Freshness = { lastSuccessAt: null, stale: false, error: null };
    private notices: BoardNotice[] = [];
    /** 取数产生的告警（某个 repo 失败），每轮重建 */
    private loadNotices: BoardNotice[] = [];
    private lastPublishedRevision = '';
    private inFlight = false;
    private loading = false;
    private disposed = false;
    private visible = false;
    /** 角标要常驻：面板没打开也在跑（用更长的间隔） */
    private started = false;
    private badge: BadgeCounts = { primary: 0, secondary: 0 };
    private onBadgeChange: ((counts: BadgeCounts) => void) | undefined;
    private timer: ReturnType<typeof setTimeout> | undefined;
    /** /user 拉一次就缓存；token 换了由 GitLabService 自己作废 */
    private viewer: GitLabUser | null = null;

    private readonly gitlab = new GitLabService();
    /** 事实库；null = 不可用，界面照常用内存态 */
    private readonly store: FactStore | null;
    /** 库的病况（损坏重建 / 更高版本只读）：只在板内说一次 */
    private readonly storeNotice: BoardNotice | null;
    private ephemeralNotice: BoardNotice | null = null;
    /** 这一轮是否由用户手动触发（忽略新鲜度去抢位） */
    private manualRequest = false;
    private retryBudget = 0;
    private readonly ownerId = crypto.randomUUID();
    private followTimer: ReturnType<typeof setTimeout> | undefined;
    private lastDataVersion: number | null = null;

    constructor(factsPath?: string) {
        const opened = factsPath ? FactStore.openWithStatus(factsPath) : null;
        this.store = opened?.store ?? null;
        this.storeNotice = opened?.message
            ? {
                  level: 'warn',
                  message: opened.message,
                  hint:
                      opened.status === 'readonly'
                          ? '库是由更新版本的扩展写的；升级扩展后会自动恢复写入'
                          : undefined,
              }
            : null;
    }

    public findMr(iid: number, projectPath: string): MrCard | undefined {
        return [...this.reviewQueue, ...this.myMrs].find(
            (card) => card.iid === iid && card.projectPath === projectPath
        );
    }

    public async refresh(force = false): Promise<void> {
        if (this.inFlight || this.disposed) {
            return;
        }
        if (force) {
            // 手动刷新 / 面板刚打开：跳开共享缓存，拿最新的审批状态
            clearGitLabCaches();
        }
        this.inFlight = true;
        this.manualRequest = force;
        this.loading = true;
        if (this.freshness.lastSuccessAt === null) {
            this.publish(true);
        }
        try {
            await this.load();
        } finally {
            this.inFlight = false;
            this.loading = false;
            this.publish(force);
            this.updateBadge();
        }
    }

    /** 角标口径与「只看我的」无关：MR 天然按 reviewer / author 两条腿取数 */
    private updateBadge(): void {
        const next = countMrBadges(this.reviewQueue, this.myMrs, readBadgeConfig().gitlab.mode);
        if (next.primary === this.badge.primary && next.secondary === this.badge.secondary) {
            return;
        }
        this.badge = next;
        this.onBadgeChange?.(next);
    }

    public getBadgeCounts(): BadgeCounts {
        return this.badge;
    }

    /** 先把当前值同步给订阅者：侧边栏条目重建后角标不会空着 */
    public setBadgeListener(listener: (counts: BadgeCounts) => void): void {
        this.onBadgeChange = listener;
        listener(this.badge);
    }

    /**
     * 扩展激活就开表：活动栏角标必须在「没打开看板」时也有数字。
     */
    public start(): void {
        if (this.started || this.disposed) {
            return;
        }
        this.started = true;
        // 库里已有上一次成功的个人队列：先秒开，不等网络
        if (this.restoreFromStore()) {
            this.publish(true);
            this.updateBadge();
        }
        this.scheduleFollow();
        // 启动不用 force：两个看板同时开跑，共享缓存能把重复请求合成一次
        void this.refresh(false).finally(() => this.scheduleNext());
    }

    /**
     * 从库里恢复上一次成功的个人队列并重新分类。
     *
     * 返回 false = 库里没有可用数据（首次运行 / 库不可用）。
     */
    public restoreFromStore(): boolean {
        if (!this.store) {
            return false;
        }
        const config = readMrConfig();
        if (config.repos.length === 0) {
            return false;
        }
        const viewerId = Number(this.store.meta('gitlab.viewer_id') ?? 0);
        if (!viewerId) {
            return false;
        }

        const candidates: MrCandidate[] = [];
        const approvals = new Map<string, GitLabApprovals | undefined>();
        let lastSuccess: number | null = null;

        for (const entry of config.repos) {
            const scope = `gitlab-user:${entry.gitlabProject}@${entry.targetBranch}`;
            const rows = this.store.mrsOf(scope);
            candidates.push(...mrCandidatesFromStore(rows));
            for (const row of rows) {
                if (row.state !== 'opened') {
                    continue;
                }
                approvals.set(
                    mrKey(row.project, row.iid),
                    approvalsFromStore(this.store.approvalsOf(row.project, row.iid), row)
                );
            }
            const state = this.store.fetchStateOf(scope);
            if (state?.lastSuccessAt) {
                // 取最旧的那个：任一仓库过期，整板就不能声称「刚同步」
                lastSuccess = lastSuccess === null ? state.lastSuccessAt : Math.min(lastSuccess, state.lastSuccessAt);
            }
        }

        if (candidates.length === 0) {
            return false;
        }

        const result = classify({
            candidates,
            viewerId,
            approvals,
            jiraProjects: this.keyProjects(),
        });
        this.reviewQueue = result.reviewQueue;
        this.myMrs = result.myMrs;
        this.closedCount = result.closedCount;
        this.freshness = restoredFreshness(lastSuccess);
        this.notices = this.buildNotices();
        console.log(`[mr-board] 从事实库恢复 待审=${this.reviewQueue.length}，我提交的=${this.myMrs.length}`);
        return true;
    }

    /** WebView 重建后必须能拿到当前状态：指纹没变时也要重发一次 */
    public republish(): void {
        this.publish(true);
    }

    public setVisible(visible: boolean): void {
        if (this.visible === visible) {
            return;
        }
        this.visible = visible;
        if (!visible) {
            this.scheduleNext();
            return;
        }
        void this.refresh(true).finally(() => this.scheduleNext());
    }

    public dispose(): void {
        this.disposed = true;
        this.clearTimer();
        this.clearFollow();
        this.store?.close();
    }

    private scheduleNext(): void {
        this.clearTimer();
        if (!this.started || this.disposed) {
            return;
        }
        const intervalMs =
            (this.visible ? readMrConfig().pollIntervalSec : readBadgeConfig().gitlab.pollIntervalSec) * 1000;
        this.timer = setTimeout(() => {
            void this.refresh(false).finally(() => this.scheduleNext());
        }, intervalMs);
    }

    private clearTimer(): void {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }

    /** 跟随者：每 3 秒读一次提交版本号（零查询），变了才重读并重绘 */
    private scheduleFollow(): void {
        this.clearFollow();
        if (!this.started || this.disposed) {
            return;
        }
        this.followTimer = setTimeout(() => {
            this.pollStore();
            this.scheduleFollow();
        }, FOLLOW_POLL_MS);
    }

    private clearFollow(): void {
        if (this.followTimer !== undefined) {
            clearTimeout(this.followTimer);
            this.followTimer = undefined;
        }
    }

    private pollStore(): void {
        if (!this.store) {
            return;
        }
        const version = this.store.dataVersion();
        if (version === null) {
            return;
        }
        if (this.lastDataVersion === null) {
            this.lastDataVersion = version;
            return;
        }
        if (version === this.lastDataVersion) {
            return;
        }
        this.lastDataVersion = version;
        if (this.restoreFromStore()) {
            this.publish(false);
            this.updateBadge();
        }
    }

    /** 抢不到占位：提示 + 3 秒后重试，最多 3 次 */
    private noteBusy(): void {
        this.ephemeralNotice = {
            level: 'warn',
            message: '另一个窗口正在刷新',
            hint: '同一个事实库只让一个窗口去取数；3 秒后自动重试',
        };
        if (this.retryBudget >= 3) {
            return;
        }
        this.retryBudget += 1;
        setTimeout(() => {
            if (!this.disposed) {
                void this.refresh(true);
            }
        }, FOLLOW_POLL_MS);
    }

    /** 过期由「上次成功时间」决定，不由本地是否尝试过决定 */
    private freshnessNow(): Freshness {
        const success = this.freshness.lastSuccessAt;
        const aged = success !== null && Date.now() - success > FRESHNESS_MS;
        return { ...this.freshness, stale: this.freshness.error !== null || aged };
    }

    private async load(): Promise<void> {
        this.loadNotices = [];
        const config = readMrConfig();
        const gateScope = config.repos[0]
            ? `gitlab-user:${config.repos[0].gitlabProject}@${config.repos[0].targetBranch}`
            : null;
        const manual = this.manualRequest;
        this.manualRequest = false;
        const claim = this.store && gateScope ? this.store.claimScope(gateScope, manual, this.ownerId) : 'claimed';

        if (claim === 'fresh' || claim === 'busy') {
            if (claim === 'busy' && manual) {
                this.noteBusy();
            }
            if (this.restoreFromStore()) {
                this.notices = this.buildNotices();
            }
            return;
        }
        // 'unavailable' = 库不可写：退回单窗口直连，照常取数

        try {
            if (!this.gitlab.isConfigured()) {
                throw new ConfigError(
                    '未找到 GitLab 配置，MR 看板无法取数',
                    '在 ~/.scrumbuddy/config.json 里补 gitlab.baseUrl / gitlab.token'
                );
            }

            const config = readMrConfig();

            if (config.repos.length === 0) {
                this.reviewQueue = [];
                this.myMrs = [];
                this.closedCount = 0;
                this.freshness = { lastSuccessAt: Date.now(), stale: false, error: null };
                this.notices = this.buildNotices();
                return;
            }

            if (!this.viewer) {
                this.viewer = await this.gitlab.getCurrentUser();
                this.store?.setMeta('gitlab.viewer_id', String(this.viewer.id));
            }

            const rows: GitLabMrRow[] = [];
            const reviewerKeys: string[] = [];
            const failures: string[] = [];
            /** 每个 scope 条目自己的那一份快照，成功后整体写进库 */
            const slices: Array<{ project: string; branch: string; rows: GitLabMrRow[] }> = [];
            /** 有仓库被翻页上限截断：数据能显示，但不能假装完整 */
            const truncations: string[] = [];

            // 每个 scope 条目四条腿并发：opened 用于两列，closed 只用于顶栏计数。
            // 单个仓库失败不影响其他仓库。
            await Promise.all(
                config.repos.map(async (entry) => {
                    try {
                        const [reviewerOpened, authorOpened, reviewerClosed, authorClosed] = await Promise.all([
                            this.gitlab.listMrsForUser({
                                project: entry.gitlabProject,
                                targetBranch: entry.targetBranch,
                                userId: this.viewer!.id,
                                role: 'reviewer',
                                state: 'opened',
                            }),
                            this.gitlab.listMrsForUser({
                                project: entry.gitlabProject,
                                targetBranch: entry.targetBranch,
                                userId: this.viewer!.id,
                                role: 'author',
                                state: 'opened',
                            }),
                            this.gitlab.listMrsForUser({
                                project: entry.gitlabProject,
                                targetBranch: entry.targetBranch,
                                userId: this.viewer!.id,
                                role: 'reviewer',
                                state: 'closed',
                            }),
                            this.gitlab.listMrsForUser({
                                project: entry.gitlabProject,
                                targetBranch: entry.targetBranch,
                                userId: this.viewer!.id,
                                role: 'author',
                                state: 'closed',
                            }),
                        ]);
                        reviewerKeys.push(
                            ...reviewerOpened.rows.map((row) => mrKey(entry.gitlabProject, row.iid))
                        );
                        for (const batch of [reviewerOpened, authorOpened, reviewerClosed, authorClosed]) {
                            if (batch.truncated) {
                                truncations.push(`${entry.gitlabProject} @ ${entry.targetBranch}`);
                                break;
                            }
                        }
                        rows.push(
                            ...reviewerOpened.rows,
                            ...authorOpened.rows,
                            ...reviewerClosed.rows,
                            ...authorClosed.rows
                        );
                        slices.push({
                            project: entry.gitlabProject,
                            branch: entry.targetBranch,
                            rows: [
                                ...reviewerOpened.rows,
                                ...authorOpened.rows,
                                ...reviewerClosed.rows,
                                ...authorClosed.rows,
                            ],
                        });
                    } catch (error) {
                        const described = describeError(error);
                        failures.push(`${entry.gitlabProject} @ ${entry.targetBranch}：${described.message}`);
                    }
                })
            );

            if (failures.length === config.repos.length) {
                throw new Error(`所有仓库取数失败：${failures[0]}`);
            }
            for (const failure of failures) {
                this.loadNotices.push({
                    level: 'error',
                    message: `部分仓库取数失败：${failure}`,
                    hint: '检查 pcBoard.mrBoard.scopes 与 gitlab.token',
                });
            }
            for (const truncation of truncations) {
                this.loadNotices.push({
                    level: 'warn',
                    message: `GitLab 取数被截断：${truncation} 超过 1000 条`,
                    hint: '超过 1000 条的部分不会显示；结果可能不完整',
                });
            }

            const approvals = await this.fetchApprovals(rows);
            this.persistSlices(slices, approvals);
            if (gateScope) {
                // repos[0] 失败但其他仓库成功时不会进 catch：在 Finally 之前把占位还回去，
                // 否则 45 秒内的手动刷新会被自己的占位判成 busy。
                const stamped = slices.some(
                    (slice) => `gitlab-user:${slice.project}@${slice.branch}` === gateScope
                );
                if (!stamped) {
                    this.store?.releaseScope(gateScope, '部分仓库取数失败');
                }
            }
            const result = classify({
                candidates: rows.map(toCandidate),
                viewerId: this.viewer.id,
                approvals,
                jiraProjects: this.keyProjects(),
                reviewerQueryKeys: reviewerKeys,
            });

            if (result.unseenCount > 0) {
                // 服务端忽略 reviewer_id 时，本地复核是最后一道闸；只记日志，不上界面
                console.warn(
                    `[mr-board] 服务端返回了 ${result.unseenCount} 条我并不是 reviewer 的 MR，已在本地复核中排除`
                );
            }

            this.reviewQueue = result.reviewQueue;
            this.myMrs = result.myMrs;
            this.closedCount = result.closedCount;
            this.freshness = { lastSuccessAt: Date.now(), stale: false, error: null };
            this.notices = this.buildNotices();
            this.retryBudget = 0;
            this.ephemeralNotice = null;

            console.log(
                `[mr-board] scope=${config.repos.map((repo) => `${repo.gitlabProject}@${repo.targetBranch}`).join(' / ')}` +
                    `，待审=${this.reviewQueue.length}，我提交的=${this.myMrs.length}，已关闭=${this.closedCount}`
            );
        } catch (error) {
            const described = describeError(error);
            if (this.store && gateScope) {
                this.store.releaseScope(gateScope, described.message);
            }
            this.freshness = {
                ...this.freshness,
                stale: this.freshness.lastSuccessAt !== null,
                error: described.message,
            };
            this.notices = [
                { level: 'error', message: described.message, hint: described.hint },
                ...this.buildNotices(),
            ];
        }
    }

    /**
     * MR 板的个人切片入库。
     *
     * 与 Jira 板写的分支全量用不同 scope（`gitlab-user:`）：两条查询拿到的集合不同，
     * 写进同一个 scope 会互相覆盖。
     */
    private persistSlices(
        slices: Array<{ project: string; branch: string; rows: GitLabMrRow[] }>,
        approvals: Map<string, GitLabApprovals | undefined>
    ): void {
        if (!this.store) {
            return;
        }
        for (const slice of slices) {
            const scope = `gitlab-user:${slice.project}@${slice.branch}`;
            // 四条腿（待审/我提/已关闭×2）可能命中同一个 MR：入库前按 key 去重，
            // 否则主键冲突会让整个切片回滚，库里永远停在上一次成功快照。
            const unique = new Map<string, GitLabMrRow>();
            for (const row of slice.rows) {
                unique.set(mrKey(row.projectPath, row.iid), row);
            }
            const rowsToWrite = [...unique.values()];

            const mrRows: MrRow[] = rowsToWrite.map((row) => {
                const approval = approvals.get(mrKey(row.projectPath, row.iid));
                return {
                    project: row.projectPath,
                    iid: row.iid,
                    state: row.state,
                    title: row.title,
                    sourceBranch: row.sourceBranch,
                    targetBranch: row.targetBranch,
                    authorId: row.author.id,
                    authorName: row.author.name || row.author.username || null,
                    createdAt: epochOf(row.createdAt),
                    updatedAt: epochOf(row.updatedAt),
                    mergedAt: null,
                    mergeCommitSha: null,
                    draft: row.draft,
                    hasConflicts: row.hasConflicts,
                    blockingDiscussionsResolved: row.blockingDiscussionsResolved,
                    reviewerIds: row.reviewerIds,
                    webUrl: row.url,
                    approved: approval?.approved ?? null,
                    approvalsLeft: approval?.approvalsLeft ?? null,
                };
            });

            const approvalRows: ApprovalRow[] = [];
            const queried: number[] = [];
            for (const row of rowsToWrite) {
                const key = mrKey(row.projectPath, row.iid);
                const approval = approvals.get(key);
                if (row.state === 'opened' && !row.draft && approvals.has(key)) {
                    queried.push(row.iid);
                }
                if (!approval) {
                    continue;
                }
                for (const person of approval.approvedByPeople) {
                    approvalRows.push({
                        project: row.projectPath,
                        iid: row.iid,
                        userId: person.id,
                        userName: person.name || person.username || null,
                        approvedAt: approval.approvedAtById?.[String(person.id)] ?? null,
                    });
                }
            }

            this.store.replaceGitLab(scope, {
                project: slice.project,
                mrs: mrRows,
                approvals: approvalRows,
                queriedApprovalIids: queried,
                links: [],
            });
        }
    }

    private async fetchApprovals(rows: GitLabMrRow[]): Promise<Map<string, GitLabApprovals | undefined>> {
        const unique = new Map<string, GitLabMrRow>();
        for (const row of rows) {
            const key = mrKey(row.projectPath, row.iid);
            if (!unique.has(key)) {
                unique.set(key, row);
            }
        }
        const opened = [...unique.values()].filter((row) => row.state === 'opened' && !row.draft);
        if (opened.length === 0) {
            return new Map();
        }
        const results = await GitLabService.mapWithLimit(opened, 4, (row) =>
            this.gitlab.getApprovals(row.projectPath, row.iid)
        );
        return new Map(opened.map((row, index) => [mrKey(row.projectPath, row.iid), results[index]]));
    }

    /** key 白名单：Jira 看板的项目白名单 ∪ repos 里声明的 Jira 项目 */
    private keyProjects(): string[] {
        const config = readConfig();
        const fromRepos = config.repos.flatMap((repo) => repo.jiraProjects);
        return [...new Set([...config.projects, ...fromRepos])].filter(Boolean);
    }

    private buildNotices(): BoardNotice[] {
        const config = readMrConfig();
        const notices: BoardNotice[] = [...this.loadNotices];
        if (this.storeNotice) {
            notices.push(this.storeNotice);
        }
        if (this.ephemeralNotice) {
            notices.push(this.ephemeralNotice);
        }
        if (config.repos.length === 0) {
            notices.push({
                level: 'warn',
                message: 'MR Board 的取数范围为空，看板不会显示任何卡片',
                hint: '在设置里给 pcBoard.mrBoard.scopes 增加一条「仓库路径@目标分支」',
            });
        }
        if (config.invalidScopes.length > 0) {
            notices.push({
                level: 'warn',
                message: `有 ${config.invalidScopes.length} 条取数范围写法不正确，已忽略`,
                hint: `格式应为「仓库路径@目标分支」；这些行未生效：${config.invalidScopes.join(' / ')}`,
            });
        }
        return notices;
    }

    private publish(force = false): void {
        if (this.disposed) {
            return;
        }
        const payload = this.buildPayload();
        if (!force && payload.revision === this.lastPublishedRevision) {
            return;
        }
        this.lastPublishedRevision = payload.revision;
        MrBoardPanel.post({ type: 'mrBoard:state', payload });
    }

    private buildPayload(): MrBoardPayload {
        const config = readMrConfig();
        const freshness = this.freshnessNow();
        const revision = revisionOf({
            reviewQueue: this.reviewQueue,
            myMrs: this.myMrs,
            closedCount: this.closedCount,
            scope: config.repos,
            notices: this.notices,
            stale: freshness.stale,
            error: freshness.error,
            loading: this.loading,
            syncedMinute: freshness.lastSuccessAt === null ? null : Math.floor(freshness.lastSuccessAt / 60000),
        });

        return {
            revision,
            loading: this.loading,
            reviewQueue: this.reviewQueue,
            myMrs: this.myMrs,
            closedCount: this.closedCount,
            scope: config.repos,
            freshness,
            notices: this.notices,
        };
    }
}

function toCandidate(row: GitLabMrRow): MrCandidate {
    return {
        projectPath: row.projectPath,
        iid: row.iid,
        title: row.title,
        description: row.description,
        url: row.url,
        state: row.state,
        sourceBranch: row.sourceBranch,
        targetBranch: row.targetBranch,
        author: row.author,
        reviewerIds: row.reviewerIds,
        draft: row.draft,
        hasConflicts: row.hasConflicts,
        blockingDiscussionsResolved: row.blockingDiscussionsResolved,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}
