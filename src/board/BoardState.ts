import type {
    BoardCard,
    BoardColumn,
    BoardNotice,
    BoardScope,
    BoardStatePayload,
    Freshness,
    MrFact,
    Stage,
} from '../models/Board';
import { JiraService, type JiraIssue, type JiraSprint } from '../services/JiraService';
import { GitLabService, type GitLabApprovals } from '../services/GitLabService';
import { associateMrs, toMrFacts } from '../services/MrAssociation';
import { resolveStage, type StageResult } from '../services/DeliveryStageResolver';
import { BoardPanel } from './BoardPanel';
import { ConfigError, describeError } from './errors';
import { computeDropRules } from './dropRules';
import { revisionOf } from './fingerprint';
import { readConfig, type BoardConfig, type RepoConfig } from './config';

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
    /** 阶段解析产生的告警（GitLab 未配置 / 取数失败），每轮重建 */
    private stageNotices: BoardNotice[] = [];
    private pendingKeys: string[] = [];
    private lastPublishedRevision = '';
    private inFlight = false;
    private disposed = false;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private visible = false;
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
        const factsByRepo = new Map<string, { ok: boolean; byKey: Map<string, MrFact[]> }>();

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
                    factsByRepo.set(id, { ok: false, byKey: new Map() });
                    continue;
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
                                const approval = approvals.get(fact.iid);
                                return approval
                                    ? {
                                          ...fact,
                                          approved: approval.approved,
                                          approvedBy: approval.approvedBy,
                                          approvalsLeft: approval.approvalsLeft,
                                      }
                                    : fact;
                            })
                        );
                    }
                    factsByRepo.set(id, { ok: true, byKey: facts });
                } catch (error) {
                    const described = describeError(error);
                    console.warn(`[jira-board] ${group.repo.gitlabProject}@${group.repo.targetBranch} 取数失败`, error);
                    factsByRepo.set(id, { ok: false, byKey: new Map() });
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
            const inherited = parent
                ? {
                      stage: parent.stage ?? 'unknown',
                      buildFailed: parent.buildFailed,
                      evidence: [`父任务 ${card.parentKey} 的阶段为「${parent.stage ?? '未知'}」`],
                      mr: parent.cardMr,
                      build: parent.build,
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
    ): Promise<Map<number, GitLabApprovals | null>> {
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
        factsByRepo: Map<string, { ok: boolean; byKey: Map<string, MrFact[]> }>,
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
                builds: [],
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
        const signature = revisionOf({
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
            revision: signature,
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
