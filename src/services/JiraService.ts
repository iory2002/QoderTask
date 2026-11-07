import * as http from 'http';
import { loadScrumBuddyConfig } from './ScrumBuddyConfig';

/**
 * ScrumBuddy 配置中的 Jira 部分
 */
interface ScrumBuddyJiraConfig {
    baseUrl: string;
    username: string;
    password: string;
    defaultBoardId?: number;
}

/**
 * 从 Jira 同步回来的简化 issue 结构
 */
export interface JiraSyncItem {
    jiraKey: string;
    title: string;
    description: string;
    status: string;
    url: string;
}

/**
 * Jira 服务：读取 ScrumBuddy 配置，直接调用 Jira REST API
 */
export class JiraService {
    private config: ScrumBuddyJiraConfig | null = null;

    constructor() {
        this.reloadConfig();
    }

    /**
     * 每次调用时重新读取 ~/.scrumbuddy/config.json（支持 enc: 解密）
     */
    public reloadConfig(): void {
        const full = loadScrumBuddyConfig();
        this.config = full?.jira ?? null;
    }

    /**
     * 是否已配置 Jira
     */
    public isConfigured(): boolean {
        return this.config !== null;
    }

    /**
     * 获取默认 boardId
     */
    public getDefaultBoardId(): number {
        return this.config?.defaultBoardId ?? 23;
    }

    /**
     * 发起 Jira REST API 请求
     */
    private request<T>(urlPath: string): Promise<T> {
        return new Promise((resolve, reject) => {
            if (!this.config) {
                reject(new Error('Jira not configured'));
                return;
            }
            const baseUrl = this.config.baseUrl.replace(/\/+$/, '');
            const url = new URL(urlPath, baseUrl);
            const auth = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');

            const options: http.RequestOptions = {
                hostname: url.hostname,
                port: url.port || 80,
                path: url.pathname + url.search,
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                timeout: 8000,
            };

            const req = http.request(options, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    try {
                        const body = Buffer.concat(chunks).toString('utf-8');
                        if (res.statusCode && res.statusCode >= 400) {
                            reject(new Error(`Jira API error ${res.statusCode}: ${body.substring(0, 200)}`));
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
                reject(new Error('Jira request timeout'));
            });
            req.end();
        });
    }

    /**
     * 获取活跃 Sprint
     */
    public async getActiveSprint(boardId?: number): Promise<{ id: number; name: string } | null> {
        const bid = boardId ?? this.getDefaultBoardId();
        const res = await this.request<{ values: { id: number; name: string; state: string }[] }>(
            `/rest/agile/1.0/board/${bid}/sprint?state=active`
        );
        return res.values[0] ?? null;
    }

    /**
     * 获取当前用户在指定 Sprint 中的所有 issue
     */
    public async getMySprintIssues(sprintId: number): Promise<JiraSyncItem[]> {
        const jql = encodeURIComponent(`sprint = ${sprintId} AND assignee = currentUser() AND status not in (Resolved, Closed, Done)`);
        const fields = 'summary,status,issuetype,priority,description,created,updated';
        const res = await this.request<{
            issues: {
                id: string;
                key: string;
                fields: {
                    summary: string;
                    status: { name: string };
                    issuetype: { name: string };
                    priority: { name: string };
                    description: string;
                    created: string;
                    updated: string;
                };
            }[];
        }>(`/rest/api/2/search?jql=${jql}&fields=${fields}&maxResults=100`);

        if (!this.config) { return []; }
        const baseUrl = this.config.baseUrl.replace(/\/+$/, '');

        return res.issues.map(raw => {
            const f = raw.fields;
            const type = f.issuetype?.name ?? 'Task';
            const priority = f.priority?.name ?? '';
            const status = f.status?.name ?? 'Unknown';

            // 构建简洁描述（不含 Status，状态单独显示为徽章）
            const descParts: string[] = [];
            if (type) { descParts.push(type); }
            if (priority) { descParts.push(priority); }

            return {
                jiraKey: raw.key,
                title: `[${raw.key}] ${f.summary}`,
                description: descParts.join(' | '),
                status,
                url: `${baseUrl}/browse/${raw.key}`,
            };
        });
    }

    /**
     * 一步到位：获取当前 Sprint 中我的所有任务
     * 返回 null 表示未配置或无活跃 Sprint
     */
    public async fetchMyCurrentSprintIssues(boardId?: number): Promise<JiraSyncItem[] | null> {
        this.reloadConfig();
        if (!this.isConfigured()) { return null; }
        const sprint = await this.getActiveSprint(boardId);
        if (!sprint) { return null; }
        return this.getMySprintIssues(sprint.id);
    }
}
