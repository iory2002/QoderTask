/**
 * Jira Server / Data Center 的 OAuth 1.0a 请求签名（RSA-SHA1）。
 *
 * 与 scrum-buddy 的 src/clients/jira-oauth-signer.ts 保持一致：两边共用
 * config.json 里的同一对密钥和同一个 token，签名算法不能有任何偏差。
 *
 * Jira 只保存 RSA 公钥、没有 consumer secret，所以只能用 RSA-SHA1，
 * 不能用 HMAC-SHA1。
 */
import { createSign, randomBytes } from 'crypto';

export interface OAuthSignOptions {
    consumerKey: string;
    privateKeyPem: string;
    /** 额外的 oauth_* 参数，如 oauth_token */
    extra?: Record<string, string>;
}

/** RFC 3986：encodeURIComponent 不编码 !'()*，但 OAuth 要求编码 */
export function percentEncode(value: string): string {
    return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * 生成一次请求的 Authorization 头。
 *
 * 只有 query 参数参与签名，JSON body 不参与 —— 所以写操作（指派、评论）
 * 可以带任意 payload，不会破坏签名。
 */
export function buildAuthorizationHeader(method: string, urlString: string, options: OAuthSignOptions): string {
    const url = new URL(urlString);
    const oauthParams: Record<string, string> = {
        oauth_consumer_key: options.consumerKey,
        oauth_nonce: randomBytes(16).toString('hex'),
        oauth_signature_method: 'RSA-SHA1',
        oauth_timestamp: String(Math.floor(Date.now() / 1000)),
        oauth_version: '1.0',
        ...options.extra,
    };

    const allParams: Record<string, string> = { ...oauthParams };
    for (const [key, value] of url.searchParams) {
        allParams[key] = value;
    }

    const normalized = Object.keys(allParams)
        .sort()
        .map((key) => `${percentEncode(key)}=${percentEncode(allParams[key])}`)
        .join('&');
    const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
    const baseString = [method.toUpperCase(), percentEncode(baseUrl), percentEncode(normalized)].join('&');
    const signature = createSign('RSA-SHA1').update(baseString).sign(options.privateKeyPem, 'base64');

    const fields = Object.entries(oauthParams).map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`);
    fields.push(`oauth_signature="${percentEncode(signature)}"`);
    return `OAuth ${fields.join(', ')}`;
}
