import * as https from 'https';
import * as http from 'http';
import type { MrPerson } from '../models/MrBoard';
import { countChangedLines, type DiffFileFact } from './DiffFacts';
import { fetchAllPages, PAGE_SIZE } from './paging';
import { loadScrumBuddyConfig } from './ScrumBuddyConfig';
import { createIntranetHttpsAgent, intranetTlsOptions } from './intranetTls';

/**
 * ScrumBuddy 配置中的 GitLab 部分
 */
interface ScrumBuddyGitLabConfig {
    baseUrl: string;
    token: string;
}

/** 列表接口的原始行（字段名是 GitLab 的 snake_case） */
interface RawGitLabUser {
    id?: number;
    name?: string;
    username?: string;
}

interface RawGitLabMr {
    iid: number;
    state: string;
    target_branch: string;
    source_branch?: string;
    title?: string;
    description?: string | null;
    merged_at?: string | null;
    merge_commit_sha?: string | null;
    web_url: string;
    updated_at: string;
    created_at?: string;
    author?: RawGitLabUser;
    reviewers?: RawGitLabUser[];
    draft?: boolean;
    work_in_progress?: boolean;
    /** 列表接口白送的信号：有冲突 / 阻塞讨论是否全部解决 */
    has_conflicts?: boolean | null;
    blocking_discussions_resolved?: boolean | null;
}

/** 只读通道里的 MR 事实 */
export interface GitLabMr {
    iid: number;
    state: string;
    targetBranch: string;
    sourceBranch: string;
    title: string;
    description: string;
    mergedAt?: string;
    mergeCommitSha?: string;
    webUrl: string;
    updatedAt: string;
    /** null = 服务端没返回；不是 false */
    hasConflicts: boolean | null;
    blockingDiscussionsResolved: boolean | null;
}

export interface GitLabApprovals {
    approved: boolean;
    approvalsLeft: number | null;
    /** 人名，保留给 Jira 看板的阶段推导依据展示 */
    approvedBy: string[];
    /** 审批人 id：判断「我批过没有」必须用 id，名字不可靠 */
    approvedByIds: number[];
    /** 审批人完整信息，MR Board 的浮层展示用 */
    approvedByPeople: MrPerson[];
}

export interface GitLabUser {
    id: number;
    username: string;
    name: string;
}

/** 一页都取完后的结果；truncated=true 表示服务端还有数据没取回来 */
export interface GitLabMrBatch {
    rows: GitLabMr[];
    truncated: boolean;
}

export interface GitLabMrRowBatch {
    rows: GitLabMrRow[];
    truncated: boolean;
}

/** 一次 diff 取数的结果：统一 diff 文本 + 逐文件事实 */
export interface MrDiffBundle {
    text: string;
    files: DiffFileFact[];
    /** true = 文件数超过 3 页上限，事实只能当下界 */
    truncated: boolean;
}

/** MR Board 取数用的一行事实（带作者与 reviewer，与交付阶段那套分开） */
export interface GitLabMrRow {
    projectPath: string;
    iid: number;
    title: string;
    description: string;
    url: string;
    state: string;
    sourceBranch: string;
    targetBranch: string;
    author: MrPerson;
    reviewerIds: number[];
    draft: boolean;
    hasConflicts: boolean | null;
    blockingDiscussionsResolved: boolean | null;
    createdAt: string;
    updatedAt: string;
}

function nullableBool(value: boolean | null | undefined): boolean | null {
    return typeof value === 'boolean' ? value : null;
}

function personOf(raw: RawGitLabUser | undefined): MrPerson {
    return {
        id: Number(raw?.id ?? 0),
        name: raw?.name ?? raw?.username ?? '',
        username: raw?.username ?? '',
    };
}

/**
 * 进程内共享缓存。
 *
 * Jira 看板与 MR 看板各自 new GitLabService()，但打的是同一台 GitLab：
 * 同一批 MR 的 /approvals 会被两边各查一次。缓存放模块级才能两边共用；
 * 缓存的是 Promise，所以并发的重复请求也会合成一次。
 *
 * TTL 故意短于轮询间隔（60s）：缓存只为合并「同一时刻」的重复请求，
 * 不能跨轮命中，否则每两轮才有一次真正更新。
 */
const CACHE_TTL_MS = 15_000;
const listCache = new Map<string, { at: number; promise: Promise<GitLabMrBatch> }>();
const approvalsCache = new Map<string, { at: number; promise: Promise<GitLabApprovals | undefined> }>();

/** 用户手动刷新时清掉，别让「刷新」拿到一分钟前的缓存 */
export function clearGitLabCaches(): void {
    listCache.clear();
    approvalsCache.clear();
}

export class GitLabApiError extends Error {
    constructor(
        public readonly status: number,
        message: string,
        public readonly body: string
    ) {
        super(message);
        this.name = 'GitLabApiError';
    }

    public get readable(): string {
        if (this.status === 401) {
            return 'GitLab 认证失败：检查 ~/.scrumbuddy/config.json 的 gitlab.token';
        }
        if (this.status === 403) {
            return 'GitLab 拒绝访问：token 权限不足（~/.scrumbuddy/config.json 的 gitlab.token）';
        }
        if (this.status === 404) {
            return 'GitLab 项目或接口不存在：检查 pcBoard.repos 里的 gitlabProject 与 targetBranch';
        }
        if (this.status >= 500) {
            return `GitLab 服务端错误 ${this.status}，稍后重试`;
        }
        return `GitLab 请求失败 ${this.status}`;
    }
}

/**
 * GitLab 服务：读取 ScrumBuddy 配置，调用 GitLab REST API
 * 获取与当前用户相关的 Merge Requests（作者/审核者/被指派者）
 */
export class GitLabService {
    private config: ScrumBuddyGitLabConfig | null = null;
    /** 配置签名：baseUrl / token 变了就作废用户缓存与共享缓存 */
    private configSignature = '';
    /** /user 的会话内缓存；token 变了就作废 */
    private userCache: GitLabUser | null = null;
    // 允许自签名证书（企业内部环境常见）
    private httpsAgent = createIntranetHttpsAgent();

    constructor() {
        this.reloadConfig();
    }

    /**
     * 每次调用时重新读取 ~/.scrumbuddy/config.json（支持 enc: 解密）
     */
    public reloadConfig(): void {
        const full = loadScrumBuddyConfig();
        const next = full?.gitlab ?? null;
        const signature = `${next?.baseUrl ?? ''}|${next?.token ?? ''}`;
        if (this.configSignature !== signature) {
            this.userCache = null;
            clearGitLabCaches();
            this.configSignature = signature;
        }
        this.config = next;
    }

    public isConfigured(): boolean {
        this.reloadConfig();
        return this.config !== null && !!this.config.baseUrl;
    }

    /**
     * 目标分支上的 MR 列表：每轮只发这一条请求，本地 join。
     *
     * 只取阶段判定需要的字段。`state=all` 是必须的——已合入的 MR 才是「已合入」的证据。
     */
    public async listTargetBranchMrs(
        project: string,
        targetBranch: string,
        updatedAfterDays = 90
    ): Promise<GitLabMrBatch> {
        const key = `${project}@${targetBranch}@${updatedAfterDays}`;
        const cached = listCache.get(key);
        if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
            // 缓存 Promise：第二个并发调用不会再发一次请求
            return cached.promise;
        }

        const promise = this.fetchTargetBranchMrs(project, targetBranch, updatedAfterDays);
        listCache.set(key, { at: Date.now(), promise });
        try {
            return await promise;
        } catch (error) {
            // 失败不留在缓存里，下一轮要能重试
            if (listCache.get(key)?.promise === promise) {
                listCache.delete(key);
            }
            throw error;
        }
    }

    private async fetchTargetBranchMrs(
        project: string,
        targetBranch: string,
        updatedAfterDays: number
    ): Promise<GitLabMrBatch> {
        const updatedAfter = new Date(Date.now() - updatedAfterDays * 24 * 3600 * 1000).toISOString();

        // 翻到不满一页为止，上限 10 页（1000 条）。主分支上被静默截断会让
        // 已合入的卡退回「未提交」，比多几次请求糟得多；真到上限要告警。
        const page = await fetchAllPages<RawGitLabMr>((pageNumber) => {
            const query =
                `/api/v4/projects/${encodeURIComponent(project)}/merge_requests` +
                `?state=all&target_branch=${encodeURIComponent(targetBranch)}` +
                `&updated_after=${encodeURIComponent(updatedAfter)}` +
                `&per_page=${PAGE_SIZE}&page=${pageNumber}&order_by=updated_at&sort=desc`;
            return this.request<RawGitLabMr[]>(query, 15000);
        });

        return { rows: page.rows.map((row) => ({
            iid: row.iid,
            state: row.state,
            targetBranch: row.target_branch,
            sourceBranch: row.source_branch ?? '',
            title: row.title ?? '',
            description: row.description ?? '',
            mergedAt: row.merged_at ?? undefined,
            mergeCommitSha: row.merge_commit_sha ?? undefined,
            webUrl: row.web_url,
            updatedAt: row.updated_at,
            hasConflicts: nullableBool(row.has_conflicts),
            blockingDiscussionsResolved: nullableBool(row.blocking_discussions_resolved),
        })), truncated: page.truncated };
    }

    /** 当前 token 对应的用户。取不到 id 就不缓存，宁可直接失败 */
    public async getCurrentUser(): Promise<GitLabUser> {
        this.reloadConfig();
        if (this.userCache) {
            return this.userCache;
        }
        const body = await this.request<RawGitLabUser>('/api/v4/user', 10000);
        const user: GitLabUser = {
            id: Number(body.id ?? 0),
            username: body.username ?? '',
            name: body.name ?? body.username ?? '',
        };
        if (!user.id) {
            throw new Error('GitLab /user 没有返回 id，无法判断「我」是谁');
        }
        this.userCache = user;
        return user;
    }

    /**
     * MR Board 的列表：服务端按 reviewer / author 过滤，本地还要复核一次。
     *
     * opened 用于两列卡片；closed 只用于顶栏计数（merged 不拉取也不显示）。
     * 同样翻到不满一页为止：个人队列被截断会让人以为没有待审的 MR。
     */
    public async listMrsForUser(input: {
        project: string;
        targetBranch: string;
        userId: number;
        role: 'reviewer' | 'author';
        state: 'opened' | 'closed';
    }): Promise<GitLabMrRowBatch> {
        const filter = input.role === 'reviewer' ? `reviewer_id=${input.userId}` : `author_id=${input.userId}`;

        const page = await fetchAllPages<RawGitLabMr>((pageNumber) => {
            const query =
                `/api/v4/projects/${encodeURIComponent(input.project)}/merge_requests` +
                `?state=${input.state}&target_branch=${encodeURIComponent(input.targetBranch)}` +
                `&${filter}&per_page=${PAGE_SIZE}&page=${pageNumber}&order_by=updated_at&sort=desc`;
            return this.request<RawGitLabMr[]>(query, 15000);
        });

        return { rows: page.rows.map((row) => ({
            projectPath: input.project,
            iid: row.iid,
            title: row.title ?? '',
            description: row.description ?? '',
            url: row.web_url,
            state: row.state,
            sourceBranch: row.source_branch ?? '',
            targetBranch: row.target_branch,
            author: personOf(row.author),
            reviewerIds: (row.reviewers ?? []).map((reviewer) => Number(reviewer.id ?? 0)).filter(Boolean),
            draft: row.draft === true || row.work_in_progress === true,
            hasConflicts: nullableBool(row.has_conflicts),
            blockingDiscussionsResolved: nullableBool(row.blocking_discussions_resolved),
            createdAt: row.created_at ?? '',
            updatedAt: row.updated_at,
        })), truncated: page.truncated };
    }

    /**
     * 两个 ref 的 merge base。
     *
     * 祖先判定就是这一句：`merge_base(合入, 构建 SHA) === 合入` 说明构建树包含该合入。
     * 没有公共祖先时 GitLab 返回 404，这里不吞错：由调用方判 unknown 并退回时间窗。
     */
    public async getMergeBase(project: string, left: string, right: string): Promise<string> {
        const query =
            `/api/v4/projects/${encodeURIComponent(project)}/repository/merge_base` +
            `?refs[]=${encodeURIComponent(left)}&refs[]=${encodeURIComponent(right)}`;
        const body = await this.request<{ id?: string }>(query, 10000);
        if (!body.id) {
            throw new Error('GitLab merge_base 没有返回 commit id');
        }
        return body.id;
    }

    /**
     * 把一个 MR 的 diff 拼成统一 diff 文本，供评审会话阅读。
     * GitLab 的 /diffs 只给 hunk，不带文件头，所以这里补 `--- a/` / `+++ b/`。
     * 最多 3 页：超大的 MR 被截断也好过把请求拖死。
     */
    public async getMrDiffs(project: string, iid: number): Promise<MrDiffBundle> {
        const parts: string[] = [];
        const files: DiffFileFact[] = [];
        let truncated = false;

        for (let page = 1; page <= 3; page += 1) {
            const query = `/api/v4/projects/${encodeURIComponent(project)}/merge_requests/${iid}/diffs` +
                `?per_page=100&page=${page}`;
            const chunk = await this.request<
                Array<{
                    old_path?: string;
                    new_path?: string;
                    diff?: string;
                    new_file?: boolean;
                    deleted_file?: boolean;
                }>
            >(query, 20000);

            for (const entry of chunk) {
                const oldPath = entry.old_path ?? entry.new_path ?? 'unknown';
                const newPath = entry.new_path ?? oldPath;
                const diff = entry.diff ?? '';
                parts.push(`--- a/${oldPath}\n+++ b/${newPath}\n${diff}`);
                const counts = countChangedLines(diff);
                files.push({ path: newPath, additions: counts.additions, deletions: counts.deletions });
            }

            if (chunk.length < 100) {
                break;
            }
            if (page === 3) {
                // 满页且已到上限：文件数是不完整的，要点单必须写成「至少」
                truncated = true;
            }
        }

        return { text: parts.join('\n'), files, truncated };
    }

    /**
     * 审批只能看这个端点：`approved_by` 在列表与详情接口里根本不存在。
     * 判据是 `approved === true`，不是 `approved_by.length > 0`。
     *
     * 取数失败返回 undefined（未知），不能返回一个「未批准」的假结论。
     */
    public async getApprovals(project: string, iid: number): Promise<GitLabApprovals | undefined> {
        const key = `${project}!${iid}`;
        const cached = approvalsCache.get(key);
        if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
            // 缓存 Promise：两个看板同时问同一个 MR 时只发一次
            return cached.promise;
        }

        const promise = this.fetchApprovals(project, iid);
        approvalsCache.set(key, { at: Date.now(), promise });
        const value = await promise;
        if (value === undefined && approvalsCache.get(key)?.promise === promise) {
            // 取数失败要判 unknown，不能把 unknown 也冻结一分钟
            approvalsCache.delete(key);
        }
        return value;
    }

    private async fetchApprovals(project: string, iid: number): Promise<GitLabApprovals | undefined> {
        try {
            const body = await this.request<{
                approved?: boolean;
                approvals_left?: number;
                approved_by?: Array<{ user?: RawGitLabUser }>;
            }>(`/api/v4/projects/${encodeURIComponent(project)}/merge_requests/${iid}/approvals`, 10000);

            const people = (body.approved_by ?? []).map((entry) => personOf(entry.user)).filter((person) => !!person.id || !!person.name);

            return {
                approved: body.approved === true,
                approvalsLeft: typeof body.approvals_left === 'number' ? body.approvals_left : null,
                approvedBy: people.map((person) => person.name || person.username).filter(Boolean),
                approvedByIds: people.map((person) => person.id).filter(Boolean),
                approvedByPeople: people,
            };
        } catch (error) {
            console.warn(`[jira-board] 读取 MR !${iid} 审批失败，该卡将判为无法判定`, error);
            return undefined;
        }
    }

    /** 并发上限：opened MR 通常个位数，别把 GitLab 打爆 */
    public static async mapWithLimit<T, R>(
        items: T[],
        limit: number,
        worker: (item: T) => Promise<R>
    ): Promise<R[]> {
        const results: R[] = new Array(items.length);
        let cursor = 0;
        const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (cursor < items.length) {
                const index = cursor;
                cursor += 1;
                results[index] = await worker(items[index]);
            }
        });
        await Promise.all(runners);
        return results;
    }

    /**
     * 发起 GitLab REST API 请求（同时支持 http 和 https）
     */
    private request<T>(urlPath: string, timeoutMs = 8000): Promise<T> {
        return new Promise((resolve, reject) => {
            if (!this.config) {
                reject(new Error('GitLab not configured'));
                return;
            }
            const baseUrl = this.config.baseUrl.replace(/\/+$/, '');
            const url = new URL(urlPath, baseUrl);
            const isHttps = url.protocol === 'https:';
            const transport = isHttps ? https : http;

            const options: https.RequestOptions = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                method: 'GET',
                headers: {
                    'PRIVATE-TOKEN': this.config.token,
                    'Accept': 'application/json',
                },
                timeout: timeoutMs,
                ...(isHttps ? { agent: this.httpsAgent, ...intranetTlsOptions } : {}),
            };

            const req = transport.request(options, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    try {
                        const body = Buffer.concat(chunks).toString('utf-8');
                        if (res.statusCode && res.statusCode >= 400) {
                            reject(new GitLabApiError(res.statusCode, `GitLab API error ${res.statusCode}`, body));
                            return;
                        }
                        resolve(JSON.parse(body) as T);
                    } catch (err) {
                        reject(err);
                    }
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('GitLab request timeout'));
            });
            req.end();
        });
    }
}
