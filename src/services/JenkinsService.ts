import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

import type { BuildFact } from '../models/Board';
import { loadScrumBuddyConfig } from './ScrumBuddyConfig';
import { createIntranetHttpsAgent, intranetTlsOptions } from './intranetTls';

interface ScrumBuddyJenkinsConfig {
    baseUrl: string;
    username?: string;
    token?: string;
    password?: string;
}

export class JenkinsApiError extends Error {
    constructor(
        public readonly status: number,
        message: string
    ) {
        super(message);
        this.name = 'JenkinsApiError';
    }

    public get readable(): string {
        if (this.status === 401) {
            return 'Jenkins 认证失败：检查 ~/.scrumbuddy/config.json 的 jenkins.username / jenkins.token';
        }
        if (this.status === 403) {
            return 'Jenkins 拒绝访问：当前账号没有该 job 的读权限';
        }
        if (this.status === 404) {
            return 'Jenkins job 不存在：检查 todoPanel.repos[].jenkinsJobPath';
        }
        if (this.status >= 500) {
            return `Jenkins 服务端错误 ${this.status}，稍后重试`;
        }
        return `Jenkins 请求失败 ${this.status}`;
    }
}

/**
 * job 路径逐段再编码一次：job 名里本身含字面 `%2F`，所以 URL 里是 `%252F`。
 * 少编码一次会 404，多编码一次也会 404，这一段必须钉死。
 */
export function encodeJobPath(jobPath: string): string {
    return jobPath
        .split('/')
        .filter(Boolean)
        .map((segment) => `/job/${encodeURIComponent(segment)}`)
        .join('');
}

/** 从 actions 里挖出 lastBuiltRevision.SHA1；缺失就是没有，不猜 */
export function buildShaOf(
    actions: Array<{ lastBuiltRevision?: { SHA1?: string } }> | undefined
): string | undefined {
    for (const action of actions ?? []) {
        const sha = action.lastBuiltRevision?.SHA1;
        if (sha) {
            return sha;
        }
    }
    return undefined;
}

/**
 * Jenkins 只负责「目标分支最近构建」这一件事。
 *
 * 拿不到 commit（lastBuiltRevision 无 rev、changeSet 为空、GITLAB_COMMIT_ID 恒空），
 * 所以构建判定只能走时间窗：合入时间之后有没有 SUCCESS。
 */
export class JenkinsService {
    private config: ScrumBuddyJenkinsConfig | null = null;
    private readonly httpsAgent = createIntranetHttpsAgent();

    constructor() {
        this.reloadConfig();
    }

    public reloadConfig(): void {
        const full = loadScrumBuddyConfig();
        this.config = full?.jenkins ?? null;
    }

    public isConfigured(): boolean {
        this.reloadConfig();
        return this.config !== null && !!this.config.baseUrl;
    }

    /** job 路径逐段再编码一次：job 名里本身含字面 `%2F`，所以 URL 里是 `%252F` */
    private jobUrl(jobPath: string): string {
        return encodeJobPath(jobPath);
    }

    public buildUrl(jobPath: string, number: number): string {
        const base = (this.config?.baseUrl ?? '').replace(/\/+$/, '');
        return `${base}${this.jobUrl(jobPath)}/${number}/`;
    }

    /** 最近 count 次构建；branch 用配置里的目标分支回填，供详情浮层展示 */
    public async getRecentBuilds(jobPath: string, targetBranch: string, count = 20): Promise<BuildFact[]> {
        const base = (this.config?.baseUrl ?? '').replace(/\/+$/, '');
        // lastBuiltRevision.SHA1 是该构建 checkout 的 commit：祖先判定的右边。
        // 拿不到时字段缺失，调用方退回时间窗。
        const url = new URL(
            `${base}${this.jobUrl(jobPath)}/api/json?tree=builds[number,result,timestamp,actions[lastBuiltRevision[SHA1]]]{0,${count}}`
        );
        const body = await this.request<{
            builds?: Array<{
                number: number;
                result: string | null;
                timestamp: number;
                actions?: Array<{ lastBuiltRevision?: { SHA1?: string } }>;
            }>;
        }>(url);

        return (body.builds ?? []).map((build) => ({
            number: build.number,
            result: build.result ?? null,
            timestamp: build.timestamp,
            branch: targetBranch,
            url: this.buildUrl(jobPath, build.number),
            sha: buildShaOf(build.actions),
        }));
    }

    private request<T>(url: URL): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            if (!this.config) {
                reject(new Error('Jenkins 未配置：缺少 ~/.scrumbuddy/config.json 的 jenkins 段'));
                return;
            }
            const isHttps = url.protocol === 'https:';
            const transport = isHttps ? https : http;
            const user = this.config.username ?? '';
            const secret = this.config.token ?? this.config.password ?? '';
            const auth = Buffer.from(`${user}:${secret}`).toString('base64');

            const options: https.RequestOptions = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                method: 'GET',
                headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
                timeout: 12000,
                ...(isHttps ? { agent: this.httpsAgent, ...intranetTlsOptions } : {}),
            };

            const req = transport.request(options, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    const status = res.statusCode ?? 0;
                    if (status >= 400) {
                        reject(new JenkinsApiError(status, `Jenkins API error ${status}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as T);
                    } catch (error) {
                        reject(error instanceof Error ? error : new Error(String(error)));
                    }
                });
            });

            req.on('error', (error) => reject(error));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Jenkins 请求超时（12s）'));
            });
            req.end();
        });
    }
}
