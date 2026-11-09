/**
 * 只读探针：取 board 23 的 sprint 列表与最近几轮的卡片，给跨 sprint 蓝图当真实样本。
 * 跑法：node .scratch/devops-board/research/probe-jira-sprints.js
 * 输出：stdout 的 JSON（直接抄进 prototype/cross-sprint.html 的示例数据）
 */
const http = require('http');
const https = require('https');
const { loadScrumBuddyConfig } = require('../../../out/services/ScrumBuddyConfig.js');

const cfg = loadScrumBuddyConfig();
const jira = cfg.jira;
const base = String(jira.baseUrl).replace(/\/+$/, '');
const auth = 'Basic ' + Buffer.from(`${jira.username}:${jira.password}`).toString('base64');

function get(path) {
    return new Promise((resolve, reject) => {
        const url = new URL(base + path);
        const transport = url.protocol === 'https:' ? https : http;
        const req = transport.request(
            {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname + url.search,
                method: 'GET',
                headers: { Authorization: auth, Accept: 'application/json' },
                timeout: 20000,
                ...(url.protocol === 'https:' ? { rejectUnauthorized: false } : {}),
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf-8');
                    if (res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode} ${text.slice(0, 200)}`));
                        return;
                    }
                    resolve(JSON.parse(text));
                });
            }
        );
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
        req.end();
    });
}

(async () => {
    const sprints = await get('/rest/agile/1.0/board/23/sprint?state=active,closed&maxResults=50');
    const list = (sprints.values ?? [])
        .filter((s) => s.state === 'active' || s.state === 'closed')
        .sort((a, b) => String(b.endDate ?? '').localeCompare(String(a.endDate ?? '')))
        .slice(0, 3);

    console.log('=== sprints（最近的在前） ===');
    for (const s of list) {
        console.log(`  #${s.id} ${s.name} [${s.state}] ${String(s.startDate ?? '').slice(0, 10)} ~ ${String(s.endDate ?? '').slice(0, 10)}`);
    }

    console.log('\n=== 每轮卡片（key / type / status / summary） ===');
    const sample = [];
    for (const s of list) {
        try {
            const page = await get(
                `/rest/agile/1.0/sprint/${s.id}/issue?maxResults=60&fields=summary,status,issuetype,customfield_10000,customfield_10014,assignee`
            );
            const issues = page.issues ?? [];
            console.log(`\n-- ${s.name}（${s.state}）共 ${page.total ?? issues.length} 张 --`);
            for (const issue of issues.slice(0, 25)) {
                const f = issue.fields ?? {};
                const epic = f.customfield_10000 ?? f.customfield_10014 ?? '';
                console.log(
                    `  ${issue.key} | ${(f.issuetype ?? {}).name ?? '?'} | ${(f.status ?? {}).name ?? '?'} | ${epic} | ${String(f.summary ?? '').slice(0, 46)}`
                );
            }
            sample.push({ id: s.id, name: s.name, state: s.state, total: page.total ?? issues.length });
        } catch (error) {
            console.log(`  ${s.name}: 取不到（${error.message.slice(0, 120)}）`);
        }
    }
    console.log('\n=== 汇总 ===');
    console.log(JSON.stringify(sample, null, 2));
})();
