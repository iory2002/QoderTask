import type {
    BoardCard,
    BoardColumn,
    BoardNotice,
    BoardScope,
    BoardStatePayload,
    BuildFact,
    Freshness,
    MrFact,
    Stage,
} from '../models/Board';
import { JiraService, type JiraIssue, type JiraSprint } from '../services/JiraService';
import { GitLabService, clearGitLabCaches, type GitLabApprovals } from '../services/GitLabService';
import { JenkinsService } from '../services/JenkinsService';
import { associateMrs, toMrFacts } from '../services/MrAssociation';
import { countJiraBadges, type BadgeCounts } from '../services/BadgeCounter';
import { buildChecksApplyTo, resolveStage, type StageResult } from '../services/DeliveryStageResolver';
import { stalledAfterMerge } from '../services/StalledAfterMerge';
import { BoardPanel } from './BoardPanel';
import { ConfigError, describeError } from './errors';
import { revisionOf } from './fingerprint';
import { readBadgeConfig, readConfig, type BoardConfig, type RepoConfig } from './config';

/** 一个 repo 条目取回来的事实 */
interface RepoFacts {
    /** GitLab 取数是否成功 */
    gitlabOk: boolean;
    /** Jenkins 取数是否成功；没发请求或不需要构建时为 true */
    buildsOk: boolean;
    byKey: Map<string, MrFact[]>;
    builds: BuildFact[];
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

    private readonly jira = new JiraService();
    /** 当前凭据对应的用户，用于本地「只看我的」过滤；拉一次就缓存 */
    private viewer: { name: string; displayName: string } | null = null;

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
        // 纯视图切换：数据已经在内存里，直接重发一份状态即可，不重新拉全量
        this.publish(true);
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
     * 扩展激活就开表：活动栏角标必须在「没打开看板」时也有数字。
     * 面板可见时用短间隔，不可见时降频（见 scheduleNext）。
     */
    public start(): void {
        if (this.started || this.disposed) {
            return;
        }
        this.started = true;
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

    public dispose(): void {
        this.disposed = true;
        this.clearTimer();
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

            // 身份用于本地过滤「只看我的」；拉一次就缓存，不每轮都问
            if (!this.viewer) {
                this.viewer = await this.jira.getMyself();
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
        } catch (error) {
            const described = describeError(error);
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
            statusName: fields.status?.name ?? '',
            columnName: column?.name ?? '',
            epicKey,
            epicLabel: epicKey ? epics.get(epicKey) ?? epicKey : null,
            rank: String(fields[this.rankField] ?? ''),
            assignee: fields.assignee?.displayName ?? null,
            isMine: this.viewer !== null && String(fields.assignee?.name ?? '') === this.viewer.name,
            pinned: false,
            isSubtask: fields.issuetype?.subtask === true || issueType.toLowerCase() === 'sub-task',
            parentKey: fields.parent?.key,
            commentCount: fields.comment?.total ?? 0,
            stage: null,
            buildFailed: false,
            buildChannel: 'none',
            mergedDaysAgo: null,
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
        const repoByProject = new Map<string, RepoConfig>();
        for (const repo of config.repos) {
            for (const project of repo.jiraProjects) {
                if (config.projects.includes(project)) {
                    repoByProject.set(project, repo);
                }
            }
        }
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
                    factsByRepo.set(id, { gitlabOk: false, buildsOk: true, byKey: new Map(), builds: [] });
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
                    const byKey = associateMrs(mrs, group.projects);
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
                    factsByRepo.set(id, { gitlabOk: true, buildsOk, byKey: facts, builds });
                } catch (error) {
                    const described = describeError(error);
                    console.warn(`[jira-board] ${group.repo.gitlabProject}@${group.repo.targetBranch} 取数失败`, error);
                    factsByRepo.set(id, { gitlabOk: false, buildsOk, byKey: new Map(), builds });
                    this.stageNotices.push({
                        level: 'error',
                        message: `GitLab 取数失败（${group.repo.gitlabProject} → ${group.repo.targetBranch}）：${described.message}`,
                        hint: described.hint ?? '检查 pcBoard.repos 的 gitlabProject / targetBranch 与 gitlab.token',
                    });
                }
            }
        }

        const resolved = new Map<string, StageResult>();

        // 类型决定它算不算「写代码的工作」：Task / Sub-task 没有 MR 时不报「未提交」
        for (const card of cards) {
            card.codeWork = buildChecksApplyTo(card.issueType, config.buildCheckIssueTypes);
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
                configured,
                config.buildCheckIssueTypes
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
            const inherited = parent
                ? {
                      stage: parent.stage ?? 'unknown',
                      buildFailed: parent.buildFailed,
                      evidence: [`父任务 ${card.parentKey} 的阶段为「${parent.stage ?? '未知'}」`],
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
                configured,
                config.buildCheckIssueTypes,
                inherited
            );
            resolved.set(card.key, result);
            this.applyResult(card, result, mrs);
        }
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
                inherited,
            }),
            mrs,
        };
    }

    private applyResult(card: BoardCard, result: StageResult, mrs: MrFact[]): void {
        card.stage = result.stage;
        card.buildFailed = result.buildFailed;
        card.buildChannel = result.buildChannel;
        card.build = result.build;
        card.evidence = result.evidence;
        card.mrs = mrs.map((mr) => ({ ...mr, isCardMr: mr.iid === result.cardMr?.iid }));
        // 子任务自己没有 MR时，用继承来的那个算合入时长
        const forStall = card.mrs.length > 0 ? card.mrs : result.cardMr ? [result.cardMr] : [];
        card.mergedDaysAgo = stalledAfterMerge(forStall, Date.now())?.days ?? null;
    }

    private buildNotices(): BoardNotice[] {
        const config = readConfig();
        const notices: BoardNotice[] = [...this.stageNotices];

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
        const signature = revisionOf({
            scope: this.scope,
            columns: this.columns,
            cards: this.cards,
            sprint: this.sprint?.id ?? null,
            notices: this.notices,
            stale: this.freshness.stale,
            error: this.freshness.error,
            loading: this.loading,
            // 同步时间按分钟入指纹：数据没变也会更新「同步于 hh:mm」，但不会每轮都重绘
            syncedMinute: this.freshness.lastSuccessAt === null ? null : Math.floor(this.freshness.lastSuccessAt / 60000),
        });

        return {
            revision: signature,
            loading: this.loading,
            columns: this.columns,
            cards: this.cards,
            scope: this.scope,
            projectOptions: config.projects,
            freshness: this.freshness,
            notices: this.notices,
            unmappedCount: this.unmappedCount(),
            sprintName: this.sprint?.name ?? null,
        };
    }

    /** 落在 board 列之外的 issue：有卡片但状态不属于任何列 */
    private unmappedCount(): number {
        const mapped = new Set(this.columns.flatMap((column) => column.statusIds));
        return this.cards.filter((card) => !mapped.has(card.statusId)).length;
    }
}
