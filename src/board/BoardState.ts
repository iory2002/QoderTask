import * as crypto from 'crypto';
import * as vscode from 'vscode';

import type {
    BoardCapabilities,
    BoardCard,
    BoardColumn,
    BoardNotice,
    BoardScope,
    BoardStatePayload,
    BoardView,
    BuildFact,
    CardDensity,
    Freshness,
    MrFact,
    Stage,
    StageFilterId,
} from '../models/Board';
import { JiraService, type JiraIssue, type JiraSprint } from '../services/JiraService';
import { GitLabService, clearGitLabCaches, type GitLabApprovals } from '../services/GitLabService';
import { JenkinsService } from '../services/JenkinsService';
import { associateMrsIncludingCommits, toMrFacts } from '../services/MrAssociation';
import { countJiraBadges, type BadgeCounts } from '../services/BadgeCounter';
import { buildsWorthChecking, newlyIntroducedCount, resolveContainment, type Containment } from '../services/BuildAncestry';
import { buildChecksApplyTo, inheritsParentStage, isBugLikeType, resolveStage, type StageResult } from '../services/DeliveryStageResolver';
import { epochOf } from '../services/time';
import { BoardPanel } from './BoardPanel';
import { FactStore, FOLLOW_POLL_MS, FRESHNESS_MS, type ApprovalRow, type MrRow } from './FactStore';
import { approvalsFromStore, cardFromIssue, mrFactsFromLinks, restoredFreshness } from './Restore';
import { ConfigError, describeError } from './errors';
import { revisionOf } from './fingerprint';
import { hiddenColumnIdsOf, hiddenColumnNamesOf, unmatchedHiddenColumns } from './columnVisibility';
import { normalizeStageFilters, STAGE_BADGES } from './stageFilter';
import { readBadgeConfig, readConfig, writeHiddenColumns, type BoardConfig, type RepoConfig } from './config';

/** 一个 repo 条目取回来的事实 */
interface RepoFacts {
    /** GitLab 取数是否成功 */
    gitlabOk: boolean;
    /** Jenkins 取数是否成功；没发请求或不需要构建时为 true */
    buildsOk: boolean;
    byKey: Map<string, MrFact[]>;
    builds: BuildFact[];
    /** 祖先判定结果（key = iid@构建号）；缺失 = 未知 */
    containment: Map<string, Containment>;
    /**
     * 这批 containment 是怎么来的：'restored' = 从事实库恢复，本轮没联网问过祖先关系。
     * 只用于把「推断」的原因说清楚，不参与阶段判定。
     */
    containmentNote?: 'restored';
    /** 失败构建新引入的合入数（只用于详情描述） */
    newlyIntroduced: number;
}

/** 详细 / 精简存在全局偏好里：重开窗口、重启都保持 */
const DENSITY_KEY = 'pcBoard.view.density';

/** 交付阶段勾选同样是全局视图偏好：不进库、不进设置页，不影响取数与角标 */
const STAGES_KEY = 'pcBoard.view.stages';

/** 非法值一律按详细处理：不认识的值不能把整块看板变空 */
function normalizeDensity(value: unknown): CardDensity {
    return value === 'compact' ? 'compact' : 'detailed';
}

/** 隐藏列名单的比对键：大小写与首尾空白不敏感（和 columnVisibility 的归一一致） */
function hiddenKey(names: string[]): string {
    return names
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean)
        .join('\n');
}

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
    private freshness: Freshness = { lastSuccessAt: null, stale: false, error: null };
    private notices: BoardNotice[] = [];
    /** 阶段解析产生的告警（GitLab 未配置 / 取数失败），每轮重建 */
    private stageNotices: BoardNotice[] = [];
    private lastPublishedRevision = '';
    /** 自己写 pcBoard.hiddenColumns 引发的那次配置变更：归一后的名单，用来吞掉回帧 */
    private selfHiddenWrite: string | null = null;
    private inFlight = false;
    /** 首屏还没拿到数据：前端据此显示骨架屏而不是空看板 */
    private loading = false;
    private disposed = false;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private visible = false;
    /** 角标要常驻：面板没打开也在跑（用更长的间隔） */
    private started = false;
    private badge: BadgeCounts = { primary: 0, secondary: 0 };
    private onBadgeChange: ((counts: BadgeCounts) => void) | undefined;
    /** epic key → 标题，Epic chip 显示用；很少变，跨轮次缓存 */
    private readonly epicLabels = new Map<string, string>();
    /** 详细 / 精简：全局视图偏好，不进库、不影响取数 */
    private density: CardDensity;
    /** 交付阶段勾选：同样是纯视图偏好，全选 = 不过滤 */
    private stages: StageFilterId[];
    /** 存密度偏好的全局 memento；没传就只记在当前窗口 */
    private readonly memento: vscode.Memento | undefined;

    private readonly jira = new JiraService();
    /** 事实库；null = 不可用，界面照常用内存态 */
    private readonly store: FactStore | null;
    /** 库的病况（损坏重建 / 更高版本只读）：只在板内说一次 */
    private readonly storeNotice: BoardNotice | null;
    /** 当前凭据对应的用户，用于本地「只看我的」过滤；拉一次就缓存 */
    private viewer: { name: string; displayName: string } | null = null;

    /** 这一轮是否由用户手动触发（忽略新鲜度去抢位） */
    private manualRequest = false;
    /** 手动刷新抢不到时的重试次数；不做请求队列 */
    private retryBudget = 0;
    /** 这个窗口的身份，只用于写 owner，不参与任何判定 */
    private readonly ownerId = crypto.randomUUID();
    /** 跟随者每 3 秒看一次提交版本号 */
    private followTimer: ReturnType<typeof setTimeout> | undefined;
    private lastDataVersion: number | null = null;

    constructor(factsPath?: string, memento?: vscode.Memento) {
        const opened = factsPath ? FactStore.openWithStatus(factsPath) : null;
        this.memento = memento;
        this.density = normalizeDensity(memento?.get<CardDensity>(DENSITY_KEY));
        this.stages = normalizeStageFilters(memento?.get<StageFilterId[]>(STAGES_KEY));
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
        const config = readConfig();
        this.scope = { projects: config.projects, onlyMine: config.onlyMineByDefault };
    }

    public getScope(): BoardScope {
        return this.scope;
    }

    /**
     * 纯视图切换：只改内存里的展示范围。不重新取数，也不回帧——
     * WebView 点击时已经自己画好了，再回一帧全量卡片只会让整块看板重绘。
     * 下一轮数据帧会带上这份 scope。
     */
    public setScope(scope: BoardScope): void {
        const config = readConfig();
        const allowed = new Set(config.projects);
        this.scope = {
            projects: (scope.projects ?? []).filter((project) => allowed.has(project)),
            onlyMine: scope.onlyMine !== false,
        };
    }

    /**
     * 切换详细 / 精简。
     *
     * 纯视图偏好：写全局 memento，不回帧。界面已经按新密度画好了，
     * 下一轮数据帧会把这份偏好带上；重开窗口时从 memento 恢复。
     */
    public setDensity(density: CardDensity): void {
        const next = normalizeDensity(density);
        if (next === this.density) {
            return;
        }
        this.density = next;
        void this.memento?.update(DENSITY_KEY, next);
    }

    /**
     * 「交付阶段」菜单 → 勾选要看的徽章。
     *
     * 与密度一样是纯视图偏好：写全局 memento，不回帧、不重新取数。
     * 界面已经按勾选结果画好了；下一轮数据帧会把这份偏好带上，
     * 重开窗口时从 memento 恢复。卡片数据不裁剪，角标与各类计数仍看全量。
     */
    public setStages(stages: StageFilterId[]): void {
        const next = normalizeStageFilters(stages);
        if (next.join('|') === this.stages.join('|')) {
            return;
        }
        this.stages = next;
        void this.memento?.update(STAGES_KEY, next);
    }

    /**
     * 「显示列」菜单 → 写回 pcBoard.hiddenColumns。
     *
     * 数据不裁剪：只改设置里的隐藏名单，角标与各类计数仍看全量卡片。
     * 界面上 WebView 已经按勾选结果画好了；这里只负责持久化，并且记下
     * 自己写的值——由它引起的那次配置变更不再回帧（见 hiddenColumnsSettingChanged）。
     */
    public async setVisibleColumns(visibleColumnIds: string[]): Promise<void> {
        if (this.columns.length === 0) {
            // 列定义还没拿到：此时写回会把所有列都当成「要隐藏」，宁可不写
            return;
        }
        const hidden = hiddenColumnNamesOf(this.columns, visibleColumnIds ?? []);
        this.selfHiddenWrite = hiddenKey(hidden);
        try {
            await writeHiddenColumns(hidden);
        } catch (error) {
            this.selfHiddenWrite = null;
            console.warn('[jira-board] 写 pcBoard.hiddenColumns 失败', error);
            void vscode.window.showWarningMessage(
                `无法保存看板列设置：${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * 设置里的 pcBoard.hiddenColumns 变了。
     *
     * 自己刚写的那次直接吞掉：WebView 已经把勾选画好了，再回一帧只会重绘整板。
     * 其余情况（手改 settings.json、另一个窗口改的）才重发一帧让界面跟上。
     */
    public hiddenColumnsSettingChanged(): void {
        const current = hiddenKey(readConfig().hiddenColumns);
        if (this.selfHiddenWrite !== null && this.selfHiddenWrite === current) {
            this.selfHiddenWrite = null;
            return;
        }
        this.republish();
    }

    /** 上一轮没回来就不发下一轮；force 只影响「无变化也重发」 */
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
            // 首次加载：先把「加载中」推过去，否则前端会先拿到一个 0 列 0 卡的空看板
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

    /**
     * 设置里的 pcBoard.badge.jira.* 变了（mode / onlyMine / 状态名单）。
     *
     * 两组数字本来就是同一批卡片算出来的，mode 只是决定哪个上图标，
     * 所以这里用已有卡片原地重算：零请求，不用等下一轮轮询。
     */
    public recomputeBadge(): void {
        this.updateBadge();
    }

    /** 角标口径与「只看我的」视图开关无关：切换过滤器不改数字 */
    private updateBadge(): void {
        const next = countJiraBadges(this.cards, readBadgeConfig().jira);
        if (next.primary === this.badge.primary && next.secondary === this.badge.secondary) {
            return;
        }
        this.badge = next;
        this.onBadgeChange?.(next);
    }

    /** WebView 重建后必须能拿到当前状态：指纹没变时也要重发一次 */
    public republish(): void {
        this.publish(true);
    }

    /**
     * 把一张卡指派给自己。
     *
     * 写完不等下一轮轮询：先在内存里把这卡标成我的（经办人 + isMine），
     * 页面立刻有反馈；随后 force 刷一次，用 Jira 的真实值对齐。
     * 失败不吞：抛给面板，由它弹错误横幅——用户得知道为什么没指上。
     */
    public async assignToMe(key: string): Promise<void> {
        const me = await this.jira.assignToMe(key);
        const card = this.cards.find((item) => item.key === key);
        if (card) {
            card.assignee = me.displayName || card.assignee;
            card.isMine = true;
            this.publish(true);
            this.updateBadge();
        }
        void this.refresh(true);
    }

    /**
     * 扩展激活就开表：活动栏角标必须在「没打开看板」时也有数字。
     * 面板可见时用短间隔，不可见时降频（见 scheduleNext）。
     */
    public start(): void {
        if (this.started || this.disposed) {
            return;
        }
        this.started = true;
        // 库里已有上一次成功的事实：先秒开一屏，不等网络
        if (this.restoreFromStore()) {
            this.publish(true);
            this.updateBadge();
            // 库里只存了 epicKey，chip 会退化成 key；补一次标题再刷新
            void this.backfillEpicLabels();
        }
        this.scheduleFollow();
        // 启动不用 force：两个看板同时开跑，共享缓存能把重复请求合成一次
        void this.refresh(false).finally(() => this.scheduleNext());
    }

    public getBadgeCounts(): BadgeCounts {
        return this.badge;
    }

    /** 先把当前值同步给订阅者：WebView 重建后角标不会空着 */
    public setBadgeListener(listener: (counts: BadgeCounts) => void): void {
        this.onBadgeChange = listener;
        listener(this.badge);
    }

    /**
     * tab 在后台就降频，回到前台立刻刷一次再重新排下一轮。
     * 用 setTimeout 递归而不是 setInterval：天然不会出现两轮重叠。
     */
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

    private scheduleNext(): void {
        this.clearTimer();
        if (!this.started || this.disposed) {
            return;
        }
        const intervalMs =
            (this.visible ? readConfig().pollIntervalSec : readBadgeConfig().jira.pollIntervalSec) * 1000;
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
            // 指纹没变就不会重绘
            this.publish(false);
            this.updateBadge();
            void this.backfillEpicLabels();
        }
    }

    /**
     * 抢不到占位：静默重试，最多 3 次。
     *
     * 不提示用户：多窗口竞争是我们自己的实现细节，卡上多一条黄条只会让用户
     * 去关心一个他无法操作的东西。库里已经有上一次成功的数据，画面照常显示。
     */
    private noteBusy(): void {
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

    /**
     * 过期由「上次成功时间」决定，不由本地是否尝试过决定。
     *
     * 阈值不能只取 50s：轮询本身就是 60s，每次都会在 50~60s 之间闪一下「过期」。
     * 允许漏掉两拍才算旧，同时保留「任何失败都不叫新鲜」。
     */
    private freshnessNow(): Freshness {
        const success = this.freshness.lastSuccessAt;
        const intervalSec = this.visible ? readConfig().pollIntervalSec : readBadgeConfig().jira.pollIntervalSec;
        const tooOld = success !== null && Date.now() - success > Math.max(FRESHNESS_MS, intervalSec * 2000);
        return { ...this.freshness, stale: this.freshness.error !== null || tooOld };
    }

    public dispose(): void {
        this.disposed = true;
        this.clearTimer();
        this.clearFollow();
        // 正常关窗：把自己抢到的占位还回去，别让下一个窗口白等 45 秒
        this.store?.releaseClaim(`jira:${readConfig().boardId}`, this.ownerId);
        this.store?.close();
    }

    private async load(): Promise<void> {
        const gateScope = `jira:${readConfig().boardId}`;
        const manual = this.manualRequest;
        this.manualRequest = false;
        const claim = this.store ? this.store.claimScope(gateScope, manual, this.ownerId) : 'claimed';

        if (claim === 'fresh' || claim === 'busy') {
            // 另一个窗口刚取过 / 正在取：不发请求，直接读库
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

            // 身份用于本地过滤「只看我的」；拉一次就缓存，不每轮都问
            if (!this.viewer) {
                this.viewer = await this.jira.getMyself();
                this.store?.setMeta('jira.viewer_name', this.viewer.name);
                this.store?.setMeta('jira.viewer_display_name', this.viewer.displayName);
            }

            this.cards = this.sprint ? await this.fetchCards(this.sprint) : [];
            await this.applyStages(this.cards, config);

            console.log(
                `[jira-board] board ${config.boardId} 列定义：` +
                    this.columns.map((column) => `${column.name}(${column.statusIds.join(',')})`).join(' / ') +
                    `，rank=${this.rankField}，sprint=${this.sprint?.name ?? '无'}，卡片=${this.cards.length}`
            );

            this.freshness = { lastSuccessAt: Date.now(), stale: false, error: null };
            this.notices = this.buildNotices();
            this.persistJira(config);
            this.retryBudget = 0;
        } catch (error) {
            const described = describeError(error);
            this.store?.releaseScope(gateScope, described.message);
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

    private async fetchCards(sprint: JiraSprint): Promise<BoardCard[]> {
        const config = readConfig();
        // 钉住的 issue 只属于验收手段：dev 开关关闭时不参与查询
        const pinned = config.devMode ? config.extraIssueKeys : [];
        if (config.projects.length === 0 && pinned.length === 0) {
            return [];
        }

        // 「只看我的」不再进 JQL：全量拉一次，前端按 isMine 切视图
        const jql = this.buildJql(sprint, config.projects, pinned);
        const fields = [...ISSUE_FIELDS, this.rankField];
        const result = await this.jira.search(jql, fields);
        const epics = await this.resolveEpicLabels(result.issues);
        const pinnedSet = new Set(pinned);

        const cards = result.issues
            .filter((issue) => (issue.fields.issuetype?.name ?? '') !== 'Epic')
            .map((issue) => {
                const card = this.toCard(issue, epics);
                card.pinned = pinnedSet.has(card.key);
                return card;
            });

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

    private buildJql(sprint: JiraSprint, projects: string[], extraKeys: string[]): string {
        const parts: string[] = [];

        if (projects.length > 0) {
            const clauses = [
                `sprint = ${sprint.id}`,
                `project IN (${projects.join(', ')})`,
                'issuetype != Epic',
            ];
            // 注意：「只看我的」不进 JQL——全量拉取，前端按 isMine 过滤，切开关不发请求
            parts.push(`(${clauses.join(' AND ')})`);
        }

        if (extraKeys.length > 0) {
            // 钉住的 issue 不受 sprint / assignee / 项目白名单限制：显式钉了就是要看
            parts.push(`key IN (${extraKeys.join(', ')})`);
        }

        return `${parts.join(' OR ')} ORDER BY Rank ASC`;
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

    /** 一次批量查回 epic 名称；查不到就不写缓存，chip 保持不显示 */
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
                    const name = epic.fields.summary;
                    if (name) {
                        this.epicLabels.set(epic.key, name);
                    }
                }
            } catch (error) {
                console.warn('[jira-board] epic 名称拉取失败，本次不显示 epic chip', error);
            }
        }
        return this.epicLabels;
    }

    /**
     * 把 epic 名称补到卡片上。
     *
     * 分两步：缓存里没有的先查一次；无论查到与否，都按缓存回填卡片 ——
     * 恢复流程会把 epicLabel 重置成 null，不回填就会导致 chip 闪烁。
     */
    private async backfillEpicLabels(): Promise<void> {
        const missing = [
            ...new Set(this.cards.map((card) => card.epicKey).filter((key): key is string => key !== null)),
        ].filter((key) => !this.epicLabels.has(key));

        if (missing.length > 0) {
            try {
                const list = missing.slice(0, 50);
                const result = await this.jira.search(`key IN (${list.join(', ')})`, ['summary'], list.length);
                for (const epic of result.issues) {
                    const name = epic.fields.summary;
                    if (name) {
                        this.epicLabels.set(epic.key, name);
                    }
                }
            } catch (error) {
                // 查不到就继续不显示 chip，不影响其它字段
                console.warn('[jira-board] epic 名称补查失败，本次不显示 epic chip', error);
            }
        }

        let changed = false;
        for (const card of this.cards) {
            const label = card.epicKey ? this.epicLabels.get(card.epicKey) ?? null : null;
            if (label !== card.epicLabel) {
                card.epicLabel = label;
                changed = true;
            }
        }
        if (changed) {
            this.publish(false);
        }
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
            statusName: fields.status?.name ?? '',
            columnName: column?.name ?? '',
            epicKey,
            // 只显示 epic 名称；拿不到名称就不显示 chip，不要退回 key
            epicLabel: epicKey ? epics.get(epicKey) ?? null : null,
            rank: String(fields[this.rankField] ?? ''),
            assignee: fields.assignee?.displayName ?? null,
            isMine: this.viewer !== null && String(fields.assignee?.name ?? '') === this.viewer.name,
            pinned: false,
            isSubtask: fields.issuetype?.subtask === true || issueType.toLowerCase() === 'sub-task',
            parentKey: fields.parent?.key,
            commentCount: fields.comment?.total ?? 0,
            updatedAtEpoch: epochOf(fields.updated as string | undefined),
            stage: null,
            buildFailed: false,
            buildChannel: 'none',
            mrs: [],
            evidence: [],
            url: this.jira.browseUrl(issue.key),
        };
    }

    /**
     * 事实 → 阶段。每个 repo 条目每轮只发一次列表请求，本地 join 到卡片；
     * 子任务没有自己的 MR 时继承父任务的解析结果。
     */
    private async applyStages(cards: BoardCard[], config: BoardConfig): Promise<void> {
        this.stageNotices = [];
        const repoByProject = this.repoByProject(config);
        if (repoByProject.size === 0) {
            return;
        }

        const gitlab = new GitLabService();
        const configured = gitlab.isConfigured();
        const jenkins = new JenkinsService();
        const jenkinsConfigured = jenkins.isConfigured();
        const factsByRepo = new Map<string, RepoFacts>();

        if (!configured) {
            this.stageNotices.push({
                level: 'error',
                message: 'GitLab 未配置，追踪中的项目无法判定交付阶段',
                hint: '在 ~/.scrumbuddy/config.json 里补 gitlab.baseUrl / gitlab.token',
            });
        } else {
            // 同一个仓库 + 目标分支只拉一次，多个 Jira 项目可以共享
            const groups = new Map<string, { repo: RepoConfig; projects: string[] }>();
            for (const repo of config.repos) {
                // 白名单外的项目不发请求：映射可以留着，但范围收窄后不该再去拉它的 MR
                const projects = repo.jiraProjects.filter((project) => config.projects.includes(project));
                if (projects.length === 0) {
                    continue;
                }
                const id = `${repo.gitlabProject}@${repo.targetBranch}`;
                const group = groups.get(id);
                if (group) {
                    group.projects.push(...projects);
                } else {
                    groups.set(id, { repo, projects });
                }
            }

            for (const [id, group] of groups) {
                if (!group.repo.gitlabProject) {
                    factsByRepo.set(id, {
                        gitlabOk: false,
                        buildsOk: true,
                        byKey: new Map(),
                        builds: [],
                        containment: new Map(),
                        newlyIntroduced: 0,
                    });
                    continue;
                }

                // 构建是独立的一跳：GitLab 成功但 Jenkins 取不到数，阶段仍然无法判定
                let builds: BuildFact[] = [];
                let buildsOk = true;
                // Task / Sub-task 不看构建；该仓库下没有任何需要构建校验的卡时，连请求都不发
                const needsBuilds =
                    group.repo.jenkinsJobPath !== null &&
                    cards.some(
                        (card) =>
                            group.projects.includes(card.project) &&
                            buildChecksApplyTo(card.issueType, config.buildCheckIssueTypes)
                    );
                if (group.repo.jenkinsJobPath && needsBuilds) {
                    try {
                        if (!jenkinsConfigured) {
                            throw new ConfigError(
                                'Jenkins 未配置，无法判定是否已构建',
                                '在 ~/.scrumbuddy/config.json 里补 jenkins.baseUrl / jenkins.username / jenkins.token'
                            );
                        }
                        builds = await jenkins.getRecentBuilds(
                            group.repo.jenkinsJobPath,
                            group.repo.targetBranch
                        );
                    } catch (error) {
                        buildsOk = false;
                        const described = describeError(error);
                        this.store?.releaseScope(`jenkins:${group.repo.jenkinsJobPath}`, described.message);
                        console.warn(`[jira-board] Jenkins ${group.repo.jenkinsJobPath} 取数失败`, error);
                        this.stageNotices.push({
                            level: 'error',
                            message: `Jenkins 取数失败（${group.repo.targetBranch}）：${described.message}`,
                            hint: described.hint ?? '检查 pcBoard.repos[].jenkinsJobPath 与 jenkins.token',
                        });
                    }
                }

                try {
                    const batch = await gitlab.listTargetBranchMrs(
                        group.repo.gitlabProject,
                        group.repo.targetBranch
                    );
                    if (batch.truncated) {
                        // 被截断的 MR 会以「找不到」的形式消失，卡片会退回「未提交」——必须说出来
                        this.stageNotices.push({
                            level: 'warn',
                            message: `GitLab 取数被截断：${group.repo.gitlabProject} → ${group.repo.targetBranch} 90 天内超过 1000 条 MR`,
                            hint: '部分已合入的卡片可能显示为「未提交」；缩小 pcBoard.repos 的范围后再看',
                        });
                    }
                    const mrs = batch.rows;
                    // 标题 / 描述 / 源分支都没 key 的 MR 才补查提交标题：
                    // 一条 MR 一次 /commits，只补最近的一小批，不把轮询拖长
                    const byKey = await associateMrsIncludingCommits({
                        gitlabProject: group.repo.gitlabProject,
                        jiraProjects: group.projects,
                        mrs,
                        fetchCommits: (iid) => gitlab.getMrCommits(group.repo.gitlabProject, iid),
                        onError: (mr, error) =>
                            console.warn(
                                `[jira-board] 读取 MR !${mr.iid} 的提交失败，本次不做提交兜底关联`,
                                error
                            ),
                    });
                    // 只给「当前看板卡片关联到的 MR」查审批：90 天窗口里的 opened MR
                    // 大多数与这个 sprint 无关，全查等于几十个串行的 /approvals。
                    const cardKeys = new Set(cards.map((card) => card.key));
                    const relevant = [...byKey.entries()]
                        .filter((entry) => cardKeys.has(entry[0]))
                        .flatMap((entry) => entry[1].map((associated) => associated.mr));
                    const approvals = await this.fetchApprovals(gitlab, group.repo.gitlabProject, relevant);
                    const facts = new Map<string, MrFact[]>();
                    for (const [key, associated] of byKey) {
                        facts.set(
                            key,
                            toMrFacts(associated).map((fact) => {
                                if (fact.state !== 'opened') {
                                    return fact;
                                }
                                const approval = approvals.get(fact.iid);
                                // 取不到审批就不许下「未批准」的结论，交给 resolver 判 unknown
                                return approval === undefined
                                    ? { ...fact, approvalsKnown: false }
                                    : {
                                          ...fact,
                                          approved: approval.approved,
                                          approvedBy: approval.approvedBy,
                                          approvalsLeft: approval.approvalsLeft,
                                          approvalsKnown: true,
                                      };
                            })
                        );
                    }
                    const checkedBuilds = buildsWorthChecking(builds);
                    const allMrs = [...facts.values()].flat();
                    const containment = await resolveContainment({
                        gitlab,
                        project: group.repo.gitlabProject,
                        mrs: allMrs,
                        builds: checkedBuilds,
                    });
                    this.persistGitLab(group.repo, mrs, approvals, byKey);
                    if (group.repo.jenkinsJobPath && builds.length > 0) {
                        this.store?.upsertBuilds(group.repo.jenkinsJobPath, builds);
                    }
                    factsByRepo.set(id, {
                        gitlabOk: true,
                        buildsOk,
                        byKey: facts,
                        builds,
                        containment,
                        newlyIntroduced: newlyIntroducedCount(allMrs, checkedBuilds, containment),
                    });
                } catch (error) {
                    const described = describeError(error);
                    console.warn(`[jira-board] ${group.repo.gitlabProject}@${group.repo.targetBranch} 取数失败`, error);
                    factsByRepo.set(id, {
                        gitlabOk: false,
                        buildsOk,
                        byKey: new Map(),
                        builds,
                        containment: new Map(),
                        newlyIntroduced: 0,
                    });
                    this.stageNotices.push({
                        level: 'error',
                        message: `GitLab 取数失败（${group.repo.gitlabProject} → ${group.repo.targetBranch}）：${described.message}`,
                        hint: described.hint ?? '检查 pcBoard.repos 的 gitlabProject / targetBranch 与 gitlab.token',
                    });
                }
            }
        }

        this.applyResolvedStages(cards, config, repoByProject, factsByRepo, configured);
    }

    /**
     * 事实 → 阶段（纯计算，不再取数）。
     *
     * 取数路径与「从库恢复」路径共用这一段，保证两个入口走的是同一条
     * 「读事实 → 现算 → 渲染」，也不会出现一份缓存结论。
     */
    private applyResolvedStages(
        cards: BoardCard[],
        config: BoardConfig,
        repoByProject: Map<string, RepoConfig>,
        factsByRepo: Map<string, RepoFacts>,
        gitlabConfigured: boolean
    ): void {
        const resolved = new Map<string, StageResult>();

        // 类型决定它算不算「写代码的工作」：Task / Sub-task 没有 MR 时不报「未提交」。
        // 名字带 Bug 的类型（包括作为子任务开的 In-Sprint Bug）一律算代码工作，
        // 即使它没在 buildCheckIssueTypes 里也要显示「未提交」。
        for (const card of cards) {
            card.codeWork = buildChecksApplyTo(card.issueType, config.buildCheckIssueTypes) || isBugLikeType(card.issueType);
        }

        // 第一遍：非子任务
        for (const card of cards) {
            if (card.isSubtask) {
                continue;
            }
            const { result, mrs } = this.resolveCardStage(
                card,
                repoByProject,
                factsByRepo,
                gitlabConfigured,
                config.buildCheckIssueTypes,
                config.reworkStatuses
            );
            resolved.set(card.key, result);
            this.applyResult(card, result, mrs);
        }

        // 第二遍：子任务继承父任务
        for (const card of cards) {
            if (!card.isSubtask) {
                continue;
            }
            const parent = card.parentKey ? resolved.get(card.parentKey) : undefined;
            // 父任务可能不在当前看板上（只看我的时最常见）：那就没法继承，只能判「无法判定」
            // Bug 类子任务不继承：测试退回后开的 In-Sprint Bug 是新一轮代码工作，
            // 跟着 Story 会一直显示父任务那一轮的「已构建」。
            const inherited = !inheritsParentStage(card.isSubtask, card.codeWork === true)
                ? undefined
                : parent
                ? {
                      stage: parent.stage ?? 'unknown',
                      buildFailed: parent.buildFailed,
                      evidence: [
                          `父任务 ${card.parentKey} 的阶段为「${
                              STAGE_BADGES[parent.stage ?? 'unknown']?.text ?? '未知'
                          }」`,
                      ],
                      mr: parent.cardMr,
                      build: parent.build,
                  }
                : card.parentKey
                ? {
                      stage: 'unknown' as Stage,
                      buildFailed: false,
                      evidence: [`父任务 ${card.parentKey} 不在当前看板上，无法继承交付阶段`],
                      mr: undefined,
                      build: undefined,
                  }
                : undefined;

            const { result, mrs } = this.resolveCardStage(
                card,
                repoByProject,
                factsByRepo,
                gitlabConfigured,
                config.buildCheckIssueTypes,
                config.reworkStatuses,
                inherited
            );
            resolved.set(card.key, result);
            this.applyResult(card, result, mrs);
        }
    }

    private repoByProject(config: BoardConfig): Map<string, RepoConfig> {
        const repoByProject = new Map<string, RepoConfig>();
        for (const repo of config.repos) {
            for (const project of repo.jiraProjects) {
                if (config.projects.includes(project)) {
                    repoByProject.set(project, repo);
                }
            }
        }
        return repoByProject;
    }

    /**
     * 从库里恢复上一次成功的快照并现算阶段。
     *
     * 返回 false = 库里没有可用数据，调用方继续等网络。
     * 这里不发任何请求，所以拿不到祖先判定，只能退回时间窗（详情会标「推断」）。
     */
    public restoreFromStore(): boolean {
        if (!this.store) {
            return false;
        }
        const config = readConfig();
        const scope = `jira:${config.boardId}`;
        const board = this.store.boardOf(config.boardId);
        const issues = this.store.issuesOf(scope);
        if (!board || issues.length === 0) {
            return false;
        }

        this.columns = board.columns;
        this.rankField = board.rankField;
        const sprint = this.store.activeSprintOf(config.boardId);
        this.sprint = sprint ? { id: sprint.id, name: sprint.name, state: sprint.state } : null;

        const viewerName = this.store.meta('jira.viewer_display_name') ?? this.store.meta('jira.viewer_name');
        const pinnedKeys = new Set(config.devMode ? config.extraIssueKeys : []);
        this.cards = issues.map((row) => {
            const card = cardFromIssue(row, board.columns, viewerName, (key) => this.jira.browseUrl(key));
            card.pinned = pinnedKeys.has(row.key);
            // epic 名称缓存在内存里，恢复时直接带上。每次都等 backfill 会闪：
            // 写库触发的恢复重建卡片，chip 会先消失一帧再出现。
            card.epicLabel = row.epicKey ? this.epicLabels.get(row.epicKey) ?? null : null;
            return card;
        });

        const repoByProject = this.repoByProject(config);
        const factsByRepo = new Map<string, RepoFacts>();
        for (const repo of new Set(repoByProject.values())) {
            const id = `${repo.gitlabProject}@${repo.targetBranch}`;
            const mrRows = this.store.mrsOf(`gitlab:${id}`);

            const approvals = new Map<number, GitLabApprovals | undefined>();
            for (const row of mrRows) {
                if (row.state !== 'opened') {
                    continue;
                }
                // 没查过 /approvals 的 MR 返回 undefined（未知），不要编成「未批准」
                approvals.set(row.iid, approvalsFromStore(this.store.approvalsOf(row.project, row.iid), row));
            }

            const facts = mrFactsFromLinks(mrRows, this.store.linksOf(`gitlab:${id}`));
            for (const list of facts.values()) {
                for (const fact of list) {
                    if (fact.state !== 'opened') {
                        continue;
                    }
                    const approval = approvals.get(fact.iid);
                    if (approval) {
                        fact.approved = approval.approved;
                        fact.approvedBy = approval.approvedBy;
                        fact.approvalsLeft = approval.approvalsLeft;
                        fact.approvalsKnown = true;
                    } else {
                        fact.approvalsKnown = false;
                    }
                }
            }

            const builds: BuildFact[] = repo.jenkinsJobPath
                ? this.store.buildsOf(repo.jenkinsJobPath).map((row) => ({
                      number: row.number,
                      result: row.result,
                      timestamp: row.startedAt,
                      durationMs: row.durationMs ?? undefined,
                      branch: repo.targetBranch,
                      url: row.url ?? '',
                      sha: row.sha ?? undefined,
                  }))
                : [];

            // 「取数成功过」是事实，不是默认值：没成功过的 scope 必须判 unknown，
            // 否则一张从未拉到的 MR 会在恢复后变成「未提交」。
            const gitlabOk = this.store.fetchStateOf(`gitlab:${id}`)?.lastSuccessAt != null;
            const buildsOk = repo.jenkinsJobPath
                ? this.store.fetchStateOf(`jenkins:${repo.jenkinsJobPath}`)?.lastSuccessAt != null
                : true;

            factsByRepo.set(id, {
                gitlabOk,
                buildsOk,
                byKey: facts,
                builds,
                containment: new Map(),
                containmentNote: 'restored',
                newlyIntroduced: 0,
            });
        }

        this.applyResolvedStages(this.cards, config, repoByProject, factsByRepo, new GitLabService().isConfigured());
        this.freshness = restoredFreshness(this.store.lastSuccessAt(scope));
        this.notices = this.buildNotices();
        console.log(`[jira-board] 从事实库恢复 ${this.cards.length} 张卡（上一次成功 ${new Date(
            this.freshness.lastSuccessAt ?? 0
        ).toLocaleTimeString()}）`);
        return true;
    }

    private async fetchApprovals(
        gitlab: GitLabService,
        project: string,
        mrs: Array<{ iid: number; state: string }>
    ): Promise<Map<number, GitLabApprovals | undefined>> {
        const opened = [...new Set(mrs.filter((mr) => mr.state === 'opened').map((mr) => mr.iid))];
        if (opened.length === 0) {
            return new Map();
        }
        const results = await GitLabService.mapWithLimit(opened, 4, (iid) => gitlab.getApprovals(project, iid));
        return new Map(opened.map((iid, index) => [iid, results[index]]));
    }

    private resolveCardStage(
        card: BoardCard,
        repoByProject: Map<string, RepoConfig>,
        factsByRepo: Map<string, RepoFacts>,
        gitlabConfigured: boolean,
        buildCheckTypes: string[],
        reworkStatuses: string[],
        inherited?: { stage: Stage; buildFailed: boolean; evidence: string[]; mr?: MrFact; build?: StageResult['build'] }
    ): { result: StageResult; mrs: MrFact[] } {
        const repo = repoByProject.get(card.project);
        if (!repo) {
            return {
                result: resolveStage({ tracked: false, dataOk: true, buildChannel: 'none', mrs: [], builds: [] }),
                mrs: [],
            };
        }

        const repoId = `${repo.gitlabProject}@${repo.targetBranch}`;
        const repoFacts = factsByRepo.get(repoId);
        const buildChannel = repo.jenkinsJobPath ? 'full' : 'merge-only';
        const mrs = repoFacts?.byKey.get(card.key) ?? [];

        return {
            result: resolveStage({
                tracked: true,
                dataOk: gitlabConfigured && (repoFacts?.gitlabOk ?? false),
                buildsOk: repoFacts?.buildsOk ?? true,
                buildChecked: buildChecksApplyTo(card.issueType, buildCheckTypes),
                issueType: card.issueType,
                buildChannel,
                mrs,
                builds: repoFacts?.builds ?? [],
                containment: repoFacts?.containment,
                containmentNote: repoFacts?.containmentNote,
                newlyIntroduced: repoFacts?.newlyIntroduced ?? 0,
                statusName: card.statusName,
                reworkStatuses,
                inherited,
            }),
            mrs,
        };
    }

    private applyResult(card: BoardCard, result: StageResult, mrs: MrFact[]): void {
        card.stage = result.stage;
        card.buildFailed = result.buildFailed;
        card.rework = result.rework === true;
        card.buildChannel = result.buildChannel;
        card.build = result.build;
        card.evidence = result.evidence;
        card.mrs = mrs.map((mr) => ({ ...mr, isCardMr: mr.iid === result.cardMr?.iid }));
    }

    /** Jira 快照入库：board / sprint / issue 与 last_success_at 同一事务 */
    private persistJira(config: BoardConfig): void {
        this.store?.replaceJira(`jira:${config.boardId}`, {
            boardId: config.boardId,
            columns: this.columns,
            rankField: this.rankField,
            sprint: this.sprint
                ? { id: this.sprint.id, name: this.sprint.name, state: this.sprint.state, startAt: null, endAt: null }
                : null,
            cards: this.cards,
        });
    }

    /**
     * GitLab 分支快照入库。
     *
     * 只由 Jira 板写：它拉的是「目标分支全量」；MR 板拉的是按 reviewer/author 过滤的个人切片，
     * 写进同一个 scope 会把分支快照缩成个人队列，两个窗口互相覆盖。
     */
    private persistGitLab(
        repo: RepoConfig,
        mrs: Awaited<ReturnType<GitLabService['listTargetBranchMrs']>>['rows'],
        approvals: Map<number, GitLabApprovals | undefined>,
        byKey: Map<string, Array<{ mr: { iid: number }; matchedBy: string }>>
    ): void {
        if (!this.store) {
            return;
        }
        const scope = `gitlab:${repo.gitlabProject}@${repo.targetBranch}`;
        const rows: MrRow[] = mrs.map((mr) => ({
            project: repo.gitlabProject,
            iid: mr.iid,
            state: mr.state,
            title: mr.title,
            sourceBranch: mr.sourceBranch,
            targetBranch: mr.targetBranch,
            authorId: mr.authorId ?? null,
            authorName: mr.authorName ?? null,
            createdAt: epochOf(mr.createdAt),
            updatedAt: epochOf(mr.updatedAt),
            mergedAt: epochOf(mr.mergedAt),
            mergeCommitSha: mr.mergeCommitSha ?? null,
            draft: false,
            hasConflicts: mr.hasConflicts,
            blockingDiscussionsResolved: mr.blockingDiscussionsResolved,
            // 分支全量这条链不关心 reviewer，MR 板自己那份切片才写
            reviewerIds: [],
            webUrl: mr.webUrl,
            approved: approvals.get(mr.iid)?.approved ?? null,
            approvalsLeft: approvals.get(mr.iid)?.approvalsLeft ?? null,
        }));

        const approvalRows: ApprovalRow[] = [];
        for (const [iid, approval] of approvals) {
            if (!approval) {
                continue;
            }
            for (const person of approval.approvedByPeople) {
                approvalRows.push({
                    project: repo.gitlabProject,
                    iid,
                    userId: person.id,
                    userName: person.name || person.username || null,
                    approvedAt: approval.approvedAtById?.[String(person.id)] ?? null,
                });
            }
        }

        this.store.replaceGitLab(scope, {
            project: repo.gitlabProject,
            mrs: rows,
            approvals: approvalRows,
            // 只删本轮真的查过的 iid：整条分支的删法会抹掉 MR 板写的审批
            queriedApprovalIids: [...approvals.keys()],
            links: [...byKey.entries()].flatMap(([issueKey, associated]) =>
                associated.map((entry) => ({ iid: entry.mr.iid, issueKey, matchedBy: entry.matchedBy }))
            ),
        });
    }

    private buildNotices(): BoardNotice[] {
        const config = readConfig();
        const notices: BoardNotice[] = [...this.stageNotices];
        if (this.storeNotice) {
            notices.push(this.storeNotice);
        }

        if (config.projects.length === 0) {
            notices.push({
                level: 'warn',
                message: '项目白名单为空，看板不会显示任何卡片',
                hint: '设置 pcBoard.projects',
            });
        }
        if (!this.sprint && this.freshness.lastSuccessAt !== null) {
            notices.push({
                level: 'warn',
                message: '没有找到活跃 sprint，看板暂时为空',
                hint: `检查 pcBoard.boardId（当前 ${config.boardId}）在 Jira 上是否有进行中的 sprint`,
            });
        }
        if (config.repos.length === 0) {
            notices.push({
                level: 'info',
                message: '没有配置仓库映射，所有卡片都不显示交付阶段',
                hint: '设置 pcBoard.repos 才能追踪 GitLab / Jenkins',
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
        BoardPanel.post({ type: 'board:state', payload });
    }

    private buildPayload(): BoardStatePayload {
        const config = readConfig();
        const freshness = this.freshnessNow();
        // 隐藏列只算成 id 交给前端：数据不裁剪，角标与各类计数仍然看全量卡片
        const hiddenColumnIds = hiddenColumnIdsOf(this.columns, config.hiddenColumns);
        const notices = [...this.notices, ...this.hiddenColumnNotices(config)];
        const view: BoardView = { density: this.density, stages: this.stages };
        // GitLab 没配凭据时阶段恒为「无法判定」：徽章只会是噪声，交给前端整块隐藏
        const capabilities: BoardCapabilities = { gitlab: new GitLabService().isConfigured() };
        const signature = revisionOf({
            scope: this.scope,
            columns: this.columns,
            hiddenColumnIds,
            view,
            gitlabConfigured: capabilities.gitlab,
            cards: this.cards,
            sprint: this.sprint?.id ?? null,
            notices,
            stale: freshness.stale,
            error: freshness.error,
            loading: this.loading,
            // 同步时间按分钟入指纹：数据没变也会更新「同步于 hh:mm」，但不会每轮都重绘
            syncedMinute: freshness.lastSuccessAt === null ? null : Math.floor(freshness.lastSuccessAt / 60000),
        });

        return {
            revision: signature,
            loading: this.loading,
            columns: this.columns,
            hiddenColumnIds,
            cards: this.cards,
            scope: this.scope,
            view,
            capabilities,
            projectOptions: config.projects,
            freshness,
            notices,
            unmappedCount: this.unmappedCount(),
            sprintName: this.sprint?.name ?? null,
        };
    }

    /**
     * 隐藏列设置里没有命中任何看板列时提醒一句。
     *
     * 现算而不进 this.notices：改完设置下一次 publish 就该看到，
     * 而 this.notices 里的取数告警不能在这里重建（失败横幅会被抹掉）。
     */
    private hiddenColumnNotices(config: BoardConfig): BoardNotice[] {
        const unmatched = unmatchedHiddenColumns(this.columns, config.hiddenColumns);
        if (unmatched.length === 0) {
            return [];
        }
        return [
            {
                level: 'warn',
                message: `pcBoard.hiddenColumns 里的列名没有匹配到看板列：${unmatched.join('、')}`,
                hint: `当前列：${this.columns.map((column) => column.name).join(' / ')}（大小写与空格不敏感）`,
            },
        ];
    }

    /** 落在 board 列之外的 issue：有卡片但状态不属于任何列 */
    private unmappedCount(): number {
        const mapped = new Set(this.columns.flatMap((column) => column.statusIds));
        return this.cards.filter((card) => !mapped.has(card.statusId)).length;
    }
}
