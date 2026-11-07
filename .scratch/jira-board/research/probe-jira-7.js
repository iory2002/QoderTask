/**
 * 只读探针 7：验证截图那「6 issues」是不是「活跃 sprint ∩ 我」。
 * 跑法：node .scratch/jira-board/research/probe-jira-7.js
 */
const { loadScrumBuddyConfig } = require('../../../out/services/ScrumBuddyConfig.js');

const cfg = loadScrumBuddyConfig();
const jira = cfg && cfg.jira;
const base = String(jira.baseUrl).replace(/\/+$/, '');
const auth = 'Basic ' + Buffer.from(`${jira.username}:${jira.password}`).toString('base64');

async function q(jql, fields = 'summary,status,assignee') {
    const res = await fetch(base + '/rest/api/2/search?jql=' + encodeURIComponent(jql) + '&fields=' + fields + '&maxResults=50',
        { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    const t = await res.text();
    if (res.status >= 400) { console.log(`HTTP ${res.status}: ${t.slice(0, 200)}`); return null; }
    return JSON.parse(t);
}

(async () => {
    const me = await fetch(base + '/rest/api/2/myself', { headers: { Authorization: auth, Accept: 'application/json' } }).then((r) => r.json());
    console.log('当前用户 = ' + (me.name ?? '?') + ' / 显示名存在:' + !!me.displayName);

    for (const jql of [
        'sprint = 521 AND assignee = currentUser()',
        'sprint = 521 AND assignee = currentUser() AND project = NEX2',
        'sprint = 521 AND assignee = currentUser() AND project = NEX2 AND status in (Resolved, Open, "In Progress", "Pending Release", Cancelled)',
    ]) {
        const r = await q(jql);
        console.log(`\n--- ${jql}`);
        console.log(`  total = ${r?.total}`);
        for (const i of r?.issues ?? []) {
            console.log(`    ${i.key}  [${i.fields.status?.name}]  ${String(i.fields.summary).slice(0, 60)}`);
        }
    }

    // 活跃 sprint 名称
    const act = await fetch(base + '/rest/agile/1.0/board/23/sprint?state=active', { headers: { Authorization: auth, Accept: 'application/json' } }).then((r) => r.json());
    console.log('\n活跃 sprint = ' + JSON.stringify((act.values ?? []).map((s) => ({ id: s.id, name: s.name, start: s.startDate, end: s.endDate }))));

    // epic NEX2-775 的标题
    const ep = await fetch(base + '/rest/api/2/issue/NEX2-775?fields=summary,issuetype,status', { headers: { Authorization: auth, Accept: 'application/json' } }).then((r) => r.json());
    console.log('NEX2-775 = [' + ep.fields?.issuetype?.name + '] "' + ep.fields?.summary + '" status=' + ep.fields?.status?.name);
})();
