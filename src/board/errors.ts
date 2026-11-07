import { GitLabApiError } from '../services/GitLabService';
import { JenkinsApiError } from '../services/JenkinsService';
import { JiraApiError } from '../services/JiraService';

/** 配置缺失是「可修」的失败：文案必须指到具体文件与字段 */
export class ConfigError extends Error {
    constructor(
        message: string,
        public readonly hint: string
    ) {
        super(message);
        this.name = 'ConfigError';
    }
}

export function describeError(error: unknown): { message: string; hint?: string } {
    if (error instanceof ConfigError) {
        return { message: error.message, hint: error.hint };
    }
    if (error instanceof JiraApiError) {
        return { message: error.readable };
    }
    if (error instanceof GitLabApiError) {
        return { message: error.readable };
    }
    if (error instanceof JenkinsApiError) {
        return { message: error.readable };
    }
    if (error instanceof Error) {
        if (/timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(error.message)) {
            return { message: `取数超时或网络不可达（${error.message}）`, hint: '检查内网连通性或稍后重试' };
        }
        return { message: error.message };
    }
    return { message: String(error) };
}
