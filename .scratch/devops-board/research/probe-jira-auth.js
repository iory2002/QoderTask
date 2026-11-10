/**
 * 诊断 2：区分「凭据解不开」/「账号被锁」/「代理拦了」。
 * 只打印布尔与响应头，不打印任何凭据。
 */
const http = require('http');
const https = require('https');
const { loadScrumBuddyConfig } = require('../../../out/services/ScrumBuddyConfig.js');

const cfg = loadScrumBuddyConfig();
const jira = cfg.jira;
const base = String(jira.baseUrl).replace(/\/+$/, '');

console.log('baseUrl host =', new URL(base).host);
console.log('username 仍然带着 enc: 前缀吗 =', String(jira.username).startsWith('enc:'));
console.log('password 解不开（还剩 enc:）吗 =', String(jira.password).startsWith('enc:'));
console.log('password 解出来的长度 =', String(jira.password).length);

function call(method, path, headers) {
    return new Promise((resolve) => {
        const url = new URL(base + path);
        const transport = url.protocol === 'https:' ? https : http;
        const req = transport.request(
            {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname + url.search,
                method,
                headers: { Accept: 'application/json', ...headers },
                timeout: 15000,
                ...(url.protocol === 'https:' ? { rejectUnauthorized: false } : {}),
            },
            (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const body = Buffer.concat(chunks).toString('utf-8');
                    resolve({ status: res.statusCode, headers: res.headers, body });
                });
            }
        );
        req.on('timeout', () => {
            req.destroy();
            resolve({ status: 0, headers: {}, body: 'timeout' });
        });
        req.on('error', (error) => resolve({ status: 0, headers: {}, body: String(error.message) }));
        req.end();
    });
}

const picked = (headers) => {
    const keys = [
        'content-type',
        'server',
        'www-authenticate',
        'x-seraph-loginreason',
        'x-ausername',
        'x-arequestid',
        'via',
        'x-cache',
        'location',
    ];
    const out = {};
    for (const key of keys) {
        if (headers[key] !== undefined) {
            out[key] = headers[key];
        }
    }
    return out;
};

const keywords = (body) => {
    const lowered = body.toLowerCase();
    return {
        captcha: lowered.includes('captcha'),
        login: lowered.includes('login'),
        denied: lowered.includes('denied') || lowered.includes('forbidden'),
        sso: lowered.includes('sso') || lowered.includes('oauth'),
        length: body.length,
    };
};

(async () => {
    const auth = 'Basic ' + Buffer.from(`${jira.username}:${jira.password}`).toString('base64');

    const anon = await call('GET', '/rest/api/2/serverInfo', {});
    console.log('\n[匿名] serverInfo ->', anon.status, picked(anon.headers), keywords(anon.body));

    const authed = await call('GET', '/rest/api/2/myself', { Authorization: auth });
    console.log('[带认证] myself ->', authed.status, picked(authed.headers), keywords(authed.body));

    const root = await call('GET', '/', {});
    console.log('[匿名] / ->', root.status, picked(root.headers), keywords(root.body));

    const title = /<title>([^<]{0,120})<\/title>/i.exec(anon.body);
    console.log('serverInfo 页面标题 =', title ? title[1] : '(无)');
})();
