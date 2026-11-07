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
        return this.config !== null;
    }

    /**
     * 发起 GitLab REST API 请求（同时支持 http 和 https）
     */
    private request<T>(urlPath: string): Promise<T> {
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
                timeout: 8000,
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
