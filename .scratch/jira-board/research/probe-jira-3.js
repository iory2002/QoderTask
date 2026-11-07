/**
 * 只读探针 3：确认 workflow 的真实主链路。
 * 已知：In Progress --Review Code--> In Review(10101)
 * 待确认：In Review 的出口是不是 In Test(10401)？In Test 之后是什么？
 * 另：检查落在 board 列之外的状态（Blocked / Backlog / Closed / Done / Updating）有没有 issue。
 *
 * 跑法：node .scratch/jira-board/research/probe-jira-3.js
 */
const { loadScrumBuddyConfig } = require('../../../out/services/ScrumBuddyConfig.js');

const cfg = loadScrumBuddyConfig();
const jira = cfg && cfg.jira;
const base = String(jira.baseUrl).replace(/\/+$/, '');
const auth = 'Basic ' + Buffer.from(`${jira.username}:${jira.password}`).toString('base64');

async function get(path) {
    const res = await fetch(base + path, { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    if (res.status >= 400) { console.log(`HTTP ${res.status}: ${text.slice(0, 300)}`); return null; }
    try { return JSON.parse(text); } catch { return null; }
}

async function transitionsOf(statusName, q) {
    const jql = encodeURIComponent(`sprint = 521 AND status = "${statusName}" ORDER BY updated DESC`);
    const s = await get(`/rest/api/2/search?jql=${jql}&fields=summary,status&maxResults=5`);
    const issues = s?.issues ?? [];
    console.log(`\n=== ${statusName}: 命中 ${s?.total ?? 0} 条 → ${issues.map((i) => i.key).join(', ') || '无'} ===`);
    if (!issues.length) return;
    const key = issues[0].key;
    const tr = await get(`/rest/api/2/issue/${key}/transitions?expand=transitions.fields`);
    for (const t of tr?.transitions ?? []) {
        const fk = Object.keys(t.fields ?? {});
        const req = fk.filter((k) => t.fields[k]?.required);
        console.log(`  ${key}: ${t.id} "${t.name}" → "${t.to?.name}"(id=${t.to?.id})  必填=${req.join(',') || '无'}  屏幕字段=${fk.length}`);
        for (const k of req) {
            const f = t.fields[k];
            const cur = f.value !== undefined ? JSON.stringify(f.value).slice(0, 40) : '(无预置值)';
            console.log(`       ${k} (${f.name}) 当前值=${cur}`);
        }
    }
}

(async () => {
    await transitionsOf('In Review');
    await transitionsOf('In Test');

    // 列外状态普查
    console.log('\n=== 列外状态普查（全 sprint） ===');
    const statuses = ['Blocked', 'Backlog', 'Closed', 'Done', 'Updating', 'Ready for Review', 'Investigating', 'Waiting for Feedback'];
    for (const st of statuses) {
        const jql = encodeURIComponent(`sprint = 521 AND status = "${st}"`);
        const r = await get(`/rest/api/2/search?jql=${jql}&fields=summary&maxResults=1`);
        console.log(`  ${st}: total=${r?.total ?? 'err'}`);
    }

    // epic 字段是否可批量取
    console.log('\n=== Epic 字段批量取 ===');
    const ep = await get('/rest/api/2/search?jql=' + encodeURIComponent('sprint = 521') + '&fields=summary,customfield_10000,customfield_10005&maxResults=5');
    for (const i of ep?.issues ?? []) {
        console.log(`  ${i.key}: epicLink=${JSON.stringify(i.fields.customfield_10000)}  rank=${JSON.stringify(i.fields.customfield_10005)}`);
    }
    console.log(`  一次搜索取回 epic + rank：${ep ? '可用' : '不可用'}`);
})();
