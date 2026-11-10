/**
 * 诊断：逐个打 Jira 接口，看哪个返回 403，以及服务端原话。
 * 不打印任何凭据。跑法：node .scratch/devops-board/research/probe-jira-403.js
 */
const http = require('http');
const https = require('https');
const { loadScrumBuddyConfig } = require('../../../out/services/ScrumBuddyConfig.js');

const jira = loadScrumBuddyConfig().jira;
if (!jira || !jira.baseUrl) {
    console.log('没有 jira 配置');
    process.exit(1);
}
const base = String(jira.baseUrl).replace(/\/+$/, '');
const auth = 'Basic ' + Buffer.from(`${jira.username}:${jira.password}`).toString('base64');

function get(path) {
    return new Promise((resolve) => {
        const url = new URL(base + path);
        const transport = url.protocol === 'https:' ? https : http;
        const req = transport.request(
            {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname + url.search,
                method: 'GET',
                headers: { Authorization: auth, Accept: 'application/json' },
                timeout: 15000,
                ...(url.protocol === 'https:' ? { rejectUnauthorized: false } : {}),
            },
            (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf-8');
                    resolve({ status: res.statusCode, body: text.slice(0, 300) });
                });
            }
        );
        req.on('timeout', () => {
            req.destroy();
            resolve({ status: 0, body: 'timeout' });
        });
        req.on('error', (error) => resolve({ status: 0, body: String(error.message) }));
        req.end();
    });
}

(async () => {
    const boardId = 23;
    const checks = [
        ['myself', '/rest/api/2/myself'],
        ['board-config', `/rest/agile/1.0/board/${boardId}/configuration`],
        ['active-sprint', `/rest/agile/1.0/board/${boardId}/sprint?state=active`],
        ['search-sprint', `/rest/api/2/search?jql=${encodeURIComponent('sprint = 521')}&maxResults=1`],
        ['search-plain', `/rest/api/2/search?jql=${encodeURIComponent('project = NEX2 ORDER BY updated DESC')}&maxResults=1`],
    ];

    for (const [name, path] of checks) {
        const result = await get(path);
        console.log(`--- ${name}: HTTP ${result.status}`);
        console.log(result.body.replace(/\s+/g, ' ').slice(0, 260));
    }
})();
