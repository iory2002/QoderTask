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
    TransitionWriteRequest,
} from '../models/Board';
import { JiraApiError, JiraService, type JiraIssue, type JiraSprint, type RawTransition } from '../services/JiraService';
import { GitLabService, type GitLabApprovals } from '../services/GitLabService';
import { JenkinsService } from '../services/JenkinsService';
import { associateMrs, toMrFacts } from '../services/MrAssociation';
import { resolveStage, type StageResult } from '../services/DeliveryStageResolver';
import { BoardPanel } from './BoardPanel';
import { ConfigError, describeError } from './errors';
import { computeDropRules } from './dropRules';
import { buildTransitionForm } from './transitionForm';
import { revisionOf } from './fingerprint';
import { readConfig, type BoardConfig, type RepoConfig } from './config';

/** 一个 repo 条目取回来的事实 */
interface RepoFacts {
    /** GitLab 与（需要时）Jenkins 都取数成功才为 true */
    ok: boolean;
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
    private disposed = false;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private visible = false;
    /** epic key → 标题，Epic chip 显示用；很少变，跨轮次缓存 */
    private readonly epicLabels = new Map<string, string>();
    /** 最近一次拖拽拉到的 transitions：写入时按它校验并定位目标列，不跨交互复用 */
    private lastInteraction: { key: string; transitions: RawTransition[] } | null = null;
    /** 写入中的卡片：乐观移动后要顶住轮询，失败要能弹回 */
    private readonly pending = new Map<
        string,
        { prevStatusId: string; prevColumnName: string; nextStatusId: string; nextColumnName: string }
    >();

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

    /** 上一轮没回来就不发下一轮；force 只影响「无变化也重发」 */
    public async refresh(force = false): Promise<void> {
        if (this.inFlight || this.disposed) {
            return;
        }
        this.inFlight = true;
        try {
            await this.load();
        } finally {
            this.inFlight = false;
            this.publish(force);
        }
    }

    /** WebView 重建后必须能拿到当前状态：指纹没变时也要重发一次 */
    public republish(): void {
        this.publish(true);
    }

    /**
     * tab 在后台就停表，回到前台立刻刷一次再重新排下一轮。
     * 用 setTimeout 递归而不是 setInterval：天然不会出现两轮重叠。
     */
    public setVisible(visible: boolean): void {
        if (this.visible === visible) {
            return;
        }
        this.visible = visible;
        if (!visible) {
            this.clearTimer();
            return;
        }
        void this.refresh(true).finally(() => this.scheduleNext());
    }

    private scheduleNext(): void {
        this.clearTimer();
        if (!this.visible || this.disposed) {
            return;
        }
        const intervalMs = readConfig().pollIntervalSec * 1000;
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

            this.cards = this.sprint ? await this.fetchCards(this.sprint) : [];
            await this.applyStages(this.cards, config);
            this.reapplyPending();

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

    /**
     * 事实 → 阶段。每个 repo 条目每轮只发一次列表请求，本地 join 到卡片；
     * 子任务没有自己的 MR 时继承父任务的解析结果。
     */
    private async applyStages(cards: BoardCard[], config: BoardConfig): Promise<void> {
        this.stageNotices = [];
        const repoByProject = new Map<string, RepoConfig>();
        for (const repo of config.repos) {
            for (const project of repo.jiraProjects) {
                repoByProject.set(project, repo);
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
                const id = `${repo.gitlabProject}@${repo.targetBranch}`;
                const group = groups.get(id);
                if (group) {
                    group.projects.push(...repo.jiraProjects);
                } else {
                    groups.set(id, { repo, projects: [...repo.jiraProjects] });
                }
            }

            for (const [id, group] of groups) {
                if (!group.repo.gitlabProject) {
                    factsByRepo.set(id, { ok: false, byKey: new Map(), builds: [] });
                    continue;
                }

                // 构建是独立的一跳：GitLab 成功但 Jenkins 取不到数，阶段仍然无法判定
                let builds: BuildFact[] = [];
                let buildsOk = true;
                if (group.repo.jenkinsJobPath) {
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
                            hint: described.hint ?? '检查 todoPanel.repos[].jenkinsJobPath 与 jenkins.token',
                        });
                    }
                }

                try {
                    const mrs = await gitlab.listTargetBranchMrs(group.repo.gitlabProject, group.repo.targetBranch);
                    const approvals = await this.fetchApprovals(gitlab, group.repo.gitlabProject, mrs);
                    const byKey = associateMrs(mrs, group.projects);
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
                    factsByRepo.set(id, { ok: buildsOk, byKey: facts, builds });
                } catch (error) {
                    const described = describeError(error);
                    console.warn(`[jira-board] ${group.repo.gitlabProject}@${group.repo.targetBranch} 取数失败`, error);
                    factsByRepo.set(id, { ok: false, byKey: new Map(), builds });
                    this.stageNotices.push({
                        level: 'error',
                        message: `GitLab 取数失败（${group.repo.gitlabProject} → ${group.repo.targetBranch}）：${described.message}`,
                        hint: described.hint ?? '检查 todoPanel.repos 的 gitlabProject / targetBranch 与 gitlab.token',
                    });
                }
            }
        }

        const resolved = new Map<string, StageResult>();

        // 第一遍：非子任务
        for (const card of cards) {
            if (card.isSubtask) {
                continue;
            }
            const { result, mrs } = this.resolveCardStage(card, repoByProject, factsByRepo, configured);
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

            const { result, mrs } = this.resolveCardStage(card, repoByProject, factsByRepo, configured, inherited);
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
                dataOk: gitlabConfigured && (repoFacts?.ok ?? false),
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
    }

    private buildNotices(): BoardNotice[] {
        const config = readConfig();
        const notices: BoardNotice[] = [...this.stageNotices];

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

    /**
     * 拖拽合法性：每次拖拽都重新拉 transitions，不跨交互复用。
     * 合法 = 该 issue 当前可用的某个 transition 的 to.statusId 命中目标列，与列相邻与否无关。
     */
    public async fetchTransitions(key: string): Promise<void> {
        const card = this.cards.find((candidate) => candidate.key === key);
        if (!card) {
            throw new Error(`卡片 ${key} 不在当前看板上，先刷新一次`);
        }

        const transitions = await this.jira.getTransitions(key);
        this.lastInteraction = { key, transitions };
        const drops = computeDropRules({
            columns: this.columns,
            currentStatusId: card.statusId,
            transitions: transitions.map((transition) => ({
                id: transition.id,
                name: transition.name,
                toStatusId: String(transition.to?.id ?? ''),
            })),
        });
        const currentIndex = this.columns.findIndex((column) => column.statusIds.includes(card.statusId));

        // 只有合法落点才需要表单；顺带把 issue 当前字段读回来做预填
        const legalDrops = drops.filter((drop) => drop.legal);
        if (legalDrops.length > 0) {
            const issue = await this.jira.getIssue(key);
            for (const drop of legalDrops) {
                const transition = transitions.find((candidate) => candidate.id === drop.transitionId);
                const column = this.columns.find((candidate) => candidate.id === drop.columnId);
                if (!transition || !column) {
                    continue;
                }
                drop.form = buildTransitionForm({
                    key,
                    column,
                    transition: {
                        id: transition.id,
                        name: transition.name,
                        toStatusId: String(transition.to?.id ?? ''),
                        toStatusName: transition.to?.name ?? '',
                    },
                    fieldsMeta: transition.fields,
                    issueFields: issue.fields ?? {},
                    jiraUrl: this.jira.browseUrl(key),
                });
            }
        }

        BoardPanel.post({
            type: 'card:transitions',
            payload: {
                key,
                jiraUrl: this.jira.browseUrl(key),
                currentColumnId: currentIndex >= 0 ? this.columns[currentIndex].id : null,
                drops,
            },
        });
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

    /**
     * 单卡单次写入。只允许用最近一次拖拽拿到的 transition，
     * 否则说明用户看到的动作已经过期，宁可让他重新拖一次。
     */
    public async transition(request: TransitionWriteRequest): Promise<void> {
        const card = this.cards.find((candidate) => candidate.key === request.key);
        const interaction = this.lastInteraction?.key === request.key ? this.lastInteraction : null;
        const transition = interaction?.transitions.find((candidate) => candidate.id === request.transitionId);

        if (!card || !transition) {
            BoardPanel.post({
                type: 'card:transitionResult',
                payload: {
                    key: request.key,
                    ok: false,
                    error: '这张卡可用的动作已经过期，请重新拖一次',
                },
            });
            return;
        }

        try {
            // 乐观移动：先让卡片进目标列并带上「提交中」，再等 Jira 回话
            const toStatusId = String(transition.to?.id ?? '');
            const targetColumn = this.columns.find((candidate) => candidate.statusIds.includes(toStatusId));
            this.pending.set(request.key, {
                prevStatusId: card.statusId,
                prevColumnName: card.columnName,
                nextStatusId: toStatusId,
                nextColumnName: targetColumn?.name ?? card.columnName,
            });
            this.reapplyPending();
            this.publish();

            await this.jira.transition(request.key, request.transitionId, request.fields);

            // await 期间轮询可能整体替换了 this.cards，必须按 key 重新取
            this.pending.delete(request.key);
            const live = this.cards.find((candidate) => candidate.key === request.key) ?? card;
            live.statusId = toStatusId;
            live.columnName = targetColumn?.name ?? live.columnName;
            this.lastInteraction = null;

            BoardPanel.post({ type: 'card:transitionResult', payload: { key: request.key, ok: true } });
            this.publish();
            void this.refresh(true);
        } catch (error) {
            const pending = this.pending.get(request.key);
            this.pending.delete(request.key);
            if (pending) {
                const live = this.cards.find((candidate) => candidate.key === request.key) ?? card;
                live.statusId = pending.prevStatusId;
                live.columnName = pending.prevColumnName;
            }
            this.publish(true);

            const described = describeError(error);
            const fieldErrors = error instanceof JiraApiError ? error.fieldErrors : undefined;
            const hasFieldErrors = fieldErrors !== undefined && Object.keys(fieldErrors).length > 0;

            BoardPanel.post({
                type: 'card:transitionResult',
                payload: {
                    key: request.key,
                    ok: false,
                    error: hasFieldErrors ? 'Jira 拒绝了这个请求，请按字段旁的提示修改' : described.message,
                    fieldErrors: hasFieldErrors ? fieldErrors : undefined,
                },
            });
        }
    }

    /** 轮询拿回来的数据不得覆盖正在写入的卡片 */
    private reapplyPending(): void {
        if (this.pending.size === 0) {
            return;
        }
        for (const card of this.cards) {
            const entry = this.pending.get(card.key);
            if (entry) {
                card.statusId = entry.nextStatusId;
                card.columnName = entry.nextColumnName;
            }
        }
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
            pending: [...this.pending.keys()],
            // 同步时间按分钟入指纹：数据没变也会更新「同步于 hh:mm」，但不会每轮都重绘
            syncedMinute: this.freshness.lastSuccessAt === null ? null : Math.floor(this.freshness.lastSuccessAt / 60000),
        });

        return {
            revision: signature,
            columns: this.columns,
            cards: this.cards,
            scope: this.scope,
            projectOptions: config.projects,
            freshness: this.freshness,
            notices: this.notices,
            unmappedCount: this.unmappedCount(),
            sprintName: this.sprint?.name ?? null,
            pendingKeys: [...this.pending.keys()],
        };
    }

    /** 落在 board 列之外的 issue：有卡片但状态不属于任何列 */
    private unmappedCount(): number {
        const mapped = new Set(this.columns.flatMap((column) => column.statusIds));
        return this.cards.filter((card) => !mapped.has(card.statusId)).length;
    }
}
