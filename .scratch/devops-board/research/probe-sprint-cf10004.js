/**
 * 只读探针：确认 customfield_10004（Sprint）的真实形态。
 * 用户截图显示该字段是 "Sprint ZuiHuaYin(10.21), Sprint (11.4), Sprint (11.18)" 这种多值文本，
 * 而上一支探针在 VERSANAR2-1561 上没扫到它（那张卡可能根本没排过 sprint，或值不是对象数组）。
 *
 * 跑法：node .scratch/devops-board/research/probe-sprint-cf10004.js
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
    // 1) 字段元数据
    const fields = await get('/rest/api/2/field');
    if (fields.status === 200) {
        const all = JSON.parse(fields.text);
        const sprintFields = all.filter((f) => /sprint/i.test(f.name) || f.id === 'customfield_10004');
        console.log('=== 与 sprint 相关的字段 ===');
        for (const f of sprintFields) {
            console.log(`  ${f.id} | ${f.name} | custom=${f.custom} | schema=${JSON.stringify(f.schema)}`);
        }
    } else {
        console.log('field 元数据 HTTP', fields.status);
    }

    // 2) 活跃 sprint 里的卡，看 customfield_10004 的原始值
    console.log('\n=== sprint = 521 的前 5 张卡 ===');
    const search = await get(
        '/rest/api/2/search?jql=' +
            encodeURIComponent('sprint = 521 ORDER BY rank ASC') +
            '&maxResults=5&fields=summary,status,customfield_10004'
    );
    if (search.status !== 200) {
        console.log('search HTTP', search.status, search.text.slice(0, 200));
        return;
    }
    const body = JSON.parse(search.text);
    console.log('总数', body.total);
    for (const issue of body.issues ?? []) {
        const v = issue.fields.customfield_10004;
        console.log(`\n  ${issue.key} | ${issue.fields.status?.name ?? '?'} | ${String(issue.fields.summary ?? '').slice(0, 30)}`);
        console.log(`    typeof=${Array.isArray(v) ? 'array' : typeof v}  raw=${JSON.stringify(v)}`);
    }

    // 3) 一个排过多轮的老卡，验证「多值」是否还保留
    console.log('\n=== 找一张 2021 年就排过 sprint 的卡，看历史轮次是否还在 ===');
    const old = await get(
        '/rest/api/2/search?jql=' +
            encodeURIComponent('project = VERSANAR2 AND sprint is not EMPTY ORDER BY updated ASC') +
            '&maxResults=3&fields=summary,status,customfield_10004'
    );
    if (old.status === 200) {
        for (const issue of JSON.parse(old.text).issues ?? []) {
            const v = issue.fields.customfield_10004;
            console.log(`  ${issue.key} | ${issue.fields.status?.name ?? '?'} | raw=${JSON.stringify(v).slice(0, 300)}`);
        }
    } else {
        console.log('  HTTP', old.status);
    }
})();
