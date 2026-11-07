import * as https from 'https';
import * as http from 'http';
import { loadScrumBuddyConfig } from './ScrumBuddyConfig';

/**
 * ScrumBuddy 配置中的 GitLab 部分
 */
interface ScrumBuddyGitLabConfig {
    baseUrl: string;
    token: string;
    defaultProjectId?: string;
}

/**
 * 从 GitLab 同步回来的简化 MR 结构
 */
export interface GitLabSyncItem {
    gitlabMrId: string;   // MR IID（如 "42"）
    title: string;
    description: string;
    status: string;       // opened / merged / closed
    url: string;
}

/** 列表接口的原始行（字段名是 GitLab 的 snake_case） */
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
}

export interface GitLabApprovals {
    approved: boolean;
    approvalsLeft: number | null;
    approvedBy: string[];
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
            return 'GitLab 项目或接口不存在：检查 todoPanel.repos 里的 gitlabProject 与 targetBranch';
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
    // 允许自签名证书（企业内部环境常见）
    private httpsAgent = new https.Agent({ rejectUnauthorized: false });

    constructor() {
        this.reloadConfig();
    }

    /**
     * 每次调用时重新读取 ~/.scrumbuddy/config.json（支持 enc: 解密）
     */
    public reloadConfig(): void {
        const full = loadScrumBuddyConfig();
        this.config = full?.gitlab ?? null;
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
    ): Promise<GitLabMr[]> {
        const updatedAfter = new Date(Date.now() - updatedAfterDays * 24 * 3600 * 1000).toISOString();
        const query =
            `/api/v4/projects/${encodeURIComponent(project)}/merge_requests` +
            `?state=all&target_branch=${encodeURIComponent(targetBranch)}` +
            `&updated_after=${encodeURIComponent(updatedAfter)}` +
            '&per_page=100&order_by=updated_at&sort=desc';

        const rows = await this.request<RawGitLabMr[]>(query, 15000);
        return rows.map((row) => ({
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
        }));
    }

    /**
     * 审批只能看这个端点：`approved_by` 在列表与详情接口里根本不存在。
     * 判据是 `approved === true`，不是 `approved_by.length > 0`。
     */
    public async getApprovals(project: string, iid: number): Promise<GitLabApprovals | null> {
        try {
            const body = await this.request<{
                approved?: boolean;
                approvals_left?: number;
                approved_by?: Array<{ user?: { name?: string; username?: string } }>;
            }>(`/api/v4/projects/${encodeURIComponent(project)}/merge_requests/${iid}/approvals`, 10000);

            return {
                approved: body.approved === true,
                approvalsLeft: typeof body.approvals_left === 'number' ? body.approvals_left : null,
                approvedBy: (body.approved_by ?? [])
                    .map((entry) => entry.user?.name ?? entry.user?.username ?? '')
                    .filter(Boolean),
            };
        } catch (error) {
            console.warn(`[jira-board] 读取 MR !${iid} 审批失败`, error);
            return null;
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
                ...(isHttps ? { agent: this.httpsAgent } : {}),
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

    /**
     * 获取与当前用户相关的 open MR：
     * - Assignee 是我（scope=assigned-to-me）
     * - Reviewer 是我（reviewer_username=当前用户）
     * 通过 approvals API 过滤掉当前用户已审批的 MR
     */
    public async getMyMergeRequests(): Promise<GitLabSyncItem[]> {
        type RawMR = {
            iid: number;
            title: string;
            description: string | null;
            state: string;
            source_branch: string;
            target_branch: string;
            web_url: string;
            updated_at: string;
            author?: { name: string };
            merge_status?: string;
            detailed_merge_status?: string;
            project_id?: number;
        };

        // 先获取当前用户名，用于 reviewer 过滤及审批判断
        const username = await this.getCurrentUser();
        if (!username) { return []; }

        // 并行发起两个请求
        const [assignee, reviewer] = await Promise.all([
            this.request<RawMR[]>('/api/v4/merge_requests?scope=assigned-to-me&state=opened&order_by=updated_at&per_page=50'),
            this.request<RawMR[]>(`/api/v4/merge_requests?scope=all&state=opened&reviewer_username=${encodeURIComponent(username)}&order_by=updated_at&per_page=50`),
        ]);

        // 合并并去重（以 iid 为 key，同时记录角色）
        const mrMap = new Map<number, { mr: RawMR; roles: Set<string> }>();
        for (const mr of assignee) {
            mrMap.set(mr.iid, { mr, roles: new Set(['Assignee']) });
        }
        for (const mr of reviewer) {
            const entry = mrMap.get(mr.iid);
            if (entry) {
                entry.roles.add('Reviewer');
            } else {
                mrMap.set(mr.iid, { mr, roles: new Set(['Reviewer']) });
            }
        }

        // 并行检查每个 MR 的审批状态，过滤掉当前用户已审批的
        const candidates = [...mrMap.values()];
        const approvedResults = await Promise.all(
            candidates.map(({ mr }) => this.hasApprovedByUser(mr, username))
        );
        const filtered = candidates.filter((_, i) => !approvedResults[i]);

        // 按更新时间降序排列
        const sorted = filtered.sort(
            (a, b) => new Date(b.mr.updated_at).getTime() - new Date(a.mr.updated_at).getTime()
        );

        return sorted.map(({ mr, roles }) => {
            const author = mr.author?.name ?? 'Unknown';
            const branches = `${mr.source_branch} → ${mr.target_branch}`;
            const roleStr = [...roles].join(' & ');
            const mergeStatus = mr.merge_status ?? '';

            const descParts = [`MR (${roleStr})`, `Author: ${author}`, branches];
            if (mergeStatus && mergeStatus !== 'unchecked') {
                descParts.push(`Merge: ${mergeStatus}`);
            }

            return {
                gitlabMrId: String(mr.iid),
                title: `[MR!${mr.iid}] ${mr.title}`,
                description: descParts.join(' | '),
                status: mr.state,
                url: mr.web_url,
            };
        });
    }

    /**
     * 检查当前用户是否已审批指定 MR
     * 调用 /api/v4/projects/:id/merge_requests/:iid/approvals
     */
    private async hasApprovedByUser(mr: { project_id?: number; iid: number }, username: string): Promise<boolean> {
        const projectId = mr.project_id;
        if (!projectId) { return false; }
        try {
            type ApprovalInfo = {
                approved_by?: Array<{ user: { username: string } }>;
            };
            const approvals = await this.request<ApprovalInfo>(
                `/api/v4/projects/${projectId}/merge_requests/${mr.iid}/approvals`
            );
            return (approvals.approved_by ?? []).some(
                a => a.user.username === username
            );
        } catch {
            // 如果查询失败（权限不足或接口不存在），保守处理：不过滤
            return false;
        }
    }

    /**
     * 获取当前 GitLab 用户的 username（缓存）
     */
    private _cachedUsername: string | null = null;
    private async getCurrentUser(): Promise<string | null> {
        if (this._cachedUsername) { return this._cachedUsername; }
        try {
            const user = await this.request<{ username: string; name: string }>('/api/v4/user');
            this._cachedUsername = user.username;
            return user.username;
        } catch (err) {
            console.error('Failed to get GitLab user:', err);
            return null;
        }
    }

    /**
     * 一步到位：获取与我相关的所有 open MR
     * 返回 null 表示未配置
     */
    public async fetchMyMRs(): Promise<GitLabSyncItem[] | null> {
        this.reloadConfig();
        if (!this.isConfigured()) { return null; }
        return this.getMyMergeRequests();
    }
}
