/**
 * 只读探针：确认这张 Jira 上 sprint 字段是哪个 customfield、是否保留多个（含已关闭）sprint。
 * 另外打印 board 23 的列定义与活跃 sprint，用来核对「遗留轮数」能不能直接从 issue 上读。
 * 跑法：node .scratch/devops-board/research/probe-sprint-field.js
 */
const http = require('http');
const { loadScrumBuddyConfig } = require('../../../out/services/ScrumBuddyConfig.js');

const cfg = loadScrumBuddyConfig();
const jira = cfg.jira;
const base = new URL(jira.baseUrl);
const auth = 'Basic ' + Buffer.from(`${jira.username}:${jira.password}`).toString('base64');

function get(path) {
    return new Promise((resolve) => {
        const req = http.request(
            {
                hostname: base.hostname,
                port: base.port || 80,
                path,
                method: 'GET',
                headers: { Authorization: auth, Accept: 'application/json' },
                timeout: 20000,
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf-8') }));
            }
        );
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', (e) => resolve({ status: 0, text: e.message }));
        req.end();
    });
}

(async () => {
    const issue = await get('/rest/api/2/issue/VERSANAR2-1561?fields=*all');
    console.log('issue HTTP', issue.status, 'bytes', issue.text.length);
    if (issue.status === 200) {
        const f = JSON.parse(issue.text).fields ?? {};
        const allKeys = Object.keys(f);
        console.log('字段总数', allKeys.length);
        const candidates = allKeys.filter((k) => {
            const v = f[k];
            return Array.isArray(v) && v.some((x) => x && typeof x === 'object' && ('state' in x || 'startDate' in x));
        });
        console.log('疑似 sprint 字段:', candidates.join(', ') || '(无)');
        for (const k of candidates) {
            console.log(`  ${k} =`, JSON.stringify(f[k]).slice(0, 800));
        }
        const greenhopper = allKeys.filter((k) => /greenhopper|sprint/i.test(k));
        console.log('键名含 sprint 的字段:', greenhopper.join(', ') || '(无)');
    } else {
        console.log(issue.text.slice(0, 300));
    }

    const boardCfg = await get('/rest/agile/1.0/board/23/configuration');
    if (boardCfg.status === 200) {
        const j = JSON.parse(boardCfg.text);
        console.log('\nboard 23 过滤器:', j.filter?.query ?? '(无)');
        console.log('列:', (j.columnConfig?.columns ?? []).map((c) => `${c.name}[${(c.statuses ?? []).join('|')}]`).join(' / '));
        console.log('rank 字段:', Object.keys(j.ranking ?? {}).length ? JSON.stringify(j.ranking) : '(未声明)');
    } else {
        console.log('\nboard 23 configuration HTTP', boardCfg.status);
    }

    for (const state of ['active', 'future']) {
        const s = await get(`/rest/agile/1.0/board/23/sprint?state=${state}&maxResults=10`);
        if (s.status === 200) {
            const vals = JSON.parse(s.text).values ?? [];
            console.log(`board 23 sprint[${state}]:`, vals.length === 0 ? '(空)' : vals.map((v) => `#${v.id} ${v.name}`).join(' / '));
        } else {
            console.log(`board 23 sprint[${state}] HTTP ${s.status}`);
        }
    }
})();
