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

/**
 * 内网证书链失败的提示。
 *
 * Node 默认只信任自带 CA；内网证书的中间证书既不在服务端下发的链里，
 * 也不在 Node 的默认存储里，于是报 `unable to verify the first certificate`。
 * 这一步与 job 路径、token 无关，不能再把用户引到那些配置上。
 */
const TLS_CHAIN_HINT =
    'TLS 链校验失败：Node 没信任内网根证书。用仓库根目录的 run-qodercn.cmd 启动 Qoder（会设置 NODE_USE_SYSTEM_CA=1），或在系统环境变量里设置该变量后重启 IDE';

const TLS_HOSTNAME_HINT =
    '证书 SAN 与访问主机名不一致：确认请求走的是 intranetTls 的 https agent（已跳过主机名比对）';

const TLS_CHAIN_CODES = new Set([
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'UNABLE_TO_GET_ISSUER_CERT',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'CERT_UNTRUSTED',
]);

function errorCode(error: Error): string {
    return (error as NodeJS.ErrnoException).code ?? '';
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
        const code = errorCode(error);
        if (TLS_CHAIN_CODES.has(code) || /unable to verify the first certificate/i.test(error.message)) {
            return { message: `TLS 证书链校验失败（${code || 'unable to verify the first certificate'}）`, hint: TLS_CHAIN_HINT };
        }
        if (code === 'ERR_TLS_CERT_ALTNAME_INVALID' || /does not match certificate's altnames/i.test(error.message)) {
            return { message: 'TLS 主机名校验失败', hint: TLS_HOSTNAME_HINT };
        }
        if (/timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(error.message)) {
            return { message: `取数超时或网络不可达（${error.message}）`, hint: '检查内网连通性或稍后重试' };
        }
        return { message: error.message };
    }
    return { message: String(error) };
}
