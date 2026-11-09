import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

import type { BoardColumn } from '../models/Board';
import { loadScrumBuddyConfig } from './ScrumBuddyConfig';
import { createIntranetHttpsAgent, intranetTlsOptions } from './intranetTls';

/** ScrumBuddy 配置中的 Jira 部分 */
interface ScrumBuddyJiraConfig {
    baseUrl: string;
    username: string;
    password: string;
    defaultBoardId?: number;
}

/** Jira board 的列定义与 rank 字段 */
export interface JiraBoardConfig {
    columns: BoardColumn[];
    /** Jira Rank 所在的自定义字段，如 customfield_10005 */
    rankField: string;
}

export interface JiraSprint {
    id: number;
    name: string;
    state: string;
}

/** Jira 原始 issue 的最小形状，字段按需取 */
export interface JiraIssue {
    id: string;
    key: string;
    fields: Record<string, any>;
}

export interface JiraSearchResult {
    issues: JiraIssue[];
    total: number;
}

export class JiraApiError extends Error {
    constructor(
        public readonly status: number,
        message: string,
        public readonly body: string
    ) {
        super(message);
        this.name = 'JiraApiError';
    }

    /** 400 响应的 errors 是字段级结构：{ summary: "不能为空" } */
    public get fieldErrors(): Record<string, string> {
        try {
            const parsed = JSON.parse(this.body) as { errors?: Record<string, string> };
            return parsed.errors ?? {};
        } catch {
            return {};
        }
    }

    /** 给人看的错误摘要，401/403 指到具体配置文件与字段 */
    public get readable(): string {
        if (this.status === 401) {
            return 'Jira 认证失败：检查 ~/.scrumbuddy/config.json 的 jira.username / jira.password';
        }
        if (this.status === 403) {
            return 'Jira 拒绝访问：当前账号没有该 board 或该 issue 的权限（~/.scrumbuddy/config.json 的 jira.username）';
        }
        if (this.status >= 500) {
            return `Jira 服务端错误 ${this.status}，稍后重试`;
        }
        return `Jira 请求失败 ${this.status}`;
    }
}

/**
 * Jira 服务：读 ScrumBuddy 配置，直接调 Jira REST API。
 *
 * 列定义、搜索、transitions、写入都走这里。所有 HTTP 只发生在扩展进程。
 */
export class JiraService {
    private config: ScrumBuddyJiraConfig | null = null;
    // 内网自签证书
    private readonly httpsAgent = createIntranetHttpsAgent();

    constructor() {
        this.reloadConfig();
    }

    /** 每次调用前重读 ~/.scrumbuddy/config.json（支持 enc: 解密） */
    public reloadConfig(): void {
        const full = loadScrumBuddyConfig();
        this.config = full?.jira ?? null;
    }

    public isConfigured(): boolean {
        this.reloadConfig();
        return this.config !== null && !!this.config.baseUrl;
    }

    public getDefaultBoardId(): number {
        return this.config?.defaultBoardId ?? 23;
    }

    public get baseUrl(): string {
        return (this.config?.baseUrl ?? '').replace(/\/+$/, '');
    }

    public browseUrl(key: string): string {
        return `${this.baseUrl}/browse/${encodeURIComponent(key)}`;
    }

    /** 列定义来自 board 配置，不靠 transitions 反推 */
    public async getBoardConfig(boardId: number): Promise<JiraBoardConfig> {
        const response = await this.request<{
            columnConfig?: { columns?: Array<{ name: string; statuses?: Array<{ id: string }> }> };
            ranking?: { rankCustomFieldId?: number };
        }>('GET', `/rest/agile/1.0/board/${boardId}/configuration`, undefined, 10000);

        const columns = (response.columnConfig?.columns ?? []).map((column, index) => ({
            id: String(index),
            name: column.name,
            statusIds: (column.statuses ?? []).map((status) => String(status.id)),
        }));

        const rankCustomFieldId = response.ranking?.rankCustomFieldId ?? 10005;
        return { columns, rankField: `customfield_${rankCustomFieldId}` };
    }

    public async getActiveSprint(boardId: number): Promise<JiraSprint | null> {
        const response = await this.request<{ values?: JiraSprint[] }>(
            'GET',
            `/rest/agile/1.0/board/${boardId}/sprint?state=active`,
            undefined,
            10000
        );
        return response.values?.[0] ?? null;
    }

    public async getCurrentUser(): Promise<string | null> {
        try {
            const user = await this.request<{ name?: string; displayName?: string }>('GET', '/rest/api/2/myself');
            return user?.name ?? null;
        } catch {
            return null;
        }
    }

    /** 一次拉完，不分页（实测 maxResults=500 被接受） */
    public async search(jql: string, fields: string[], maxResults = 500): Promise<JiraSearchResult> {
        const query =
            `/rest/api/2/search?jql=${encodeURIComponent(jql)}` +
            `&fields=${encodeURIComponent(fields.join(','))}` +
            `&maxResults=${maxResults}`;
        const response = await this.request<{ issues?: JiraIssue[]; total?: number }>('GET', query, undefined, 10000);
        return { issues: response.issues ?? [], total: response.total ?? 0 };
    }

    /**
     * 当前凭据对应的用户。用于「只看我的」的本地过滤：
     * 一次拉全量，切开关只切视图，不再重发请求。
     */
    public async getMyself(): Promise<{ name: string; displayName: string }> {
        const me = await this.request<{ name?: string; key?: string; displayName?: string }>(
            'GET',
            '/rest/api/2/myself',
            undefined,
            5000
        );
        return { name: me.key ?? me.name ?? '', displayName: me.displayName ?? '' };
    }

    /**
     * 统一请求入口：与 GitLabService 同构的双协议实现。
     * http 实例以前被 `port || 80` 写死过，https 站点直接失效。
     *
     * 看板是只读的：这里不发 POST，改状态去 Jira 网页。
     */
    private request<T>(
        method: 'GET' | 'POST',
        urlPath: string,
        body?: unknown,
        timeoutMs = 10000
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            if (!this.config) {
                reject(new Error('Jira 未配置：缺少 ~/.scrumbuddy/config.json 的 jira 段'));
                return;
            }
            let url: URL;
            try {
                url = new URL(urlPath, this.baseUrl + '/');
            } catch (err) {
                reject(err instanceof Error ? err : new Error(String(err)));
                return;
            }

            const isHttps = url.protocol === 'https:';
            const transport = isHttps ? https : http;
            const auth = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
            const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf-8');

            const options: https.RequestOptions = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                method,
                headers: {
                    Authorization: `Basic ${auth}`,
                    Accept: 'application/json',
                    ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : {}),
                },
                timeout: timeoutMs,
                ...(isHttps ? { agent: this.httpsAgent, ...intranetTlsOptions } : {}),
            };

            const req = transport.request(options, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf-8');
                    const status = res.statusCode ?? 0;
                    if (status >= 400) {
                        reject(new JiraApiError(status, `Jira API error ${status}`, text));
                        return;
                    }
                    if (!text) {
                        resolve(undefined as unknown as T);
                        return;
                    }
                    try {
                        resolve(JSON.parse(text) as T);
                    } catch (err) {
                        reject(err instanceof Error ? err : new Error(String(err)));
                    }
                });
            });

            req.on('error', (err) => reject(err));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`Jira 请求超时（${Math.round(timeoutMs / 1000)}s）`));
            });

            if (payload) {
                req.write(payload);
            }
            req.end();
        });
    }
}
