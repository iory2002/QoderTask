/**
 * 只读探针 8：按项目统计活跃 sprint 521 的卡片数。
 * 用途：确定项目过滤下拉的候选集合与每项计数。
 * 跑法：node .scratch/jira-board/research/probe-jira-8.js
 */
const { loadScrumBuddyConfig } = require('../../../out/services/ScrumBuddyConfig.js');

const cfg = loadScrumBuddyConfig();
const jira = cfg && cfg.jira;
const base = String(jira.baseUrl).replace(/\/+$/, '');
const auth = 'Basic ' + Buffer.from(`${jira.username}:${jira.password}`).toString('base64');

async function q(jql, fields) {
    const res = await fetch(base + '/rest/api/2/search?jql=' + encodeURIComponent(jql) + '&fields=' + fields + '&maxResults=500',
        { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    const t = await res.text();
    if (res.status >= 400) { console.log(`HTTP ${res.status}: ${t.slice(0, 200)}`); return null; }
    return JSON.parse(t);
}

(async () => {
    const all = await q('sprint = 521', 'project,issuetype,assignee');
    const byProject = {};
    const byProjectMine = {};
    const byType = {};
    for (const i of all?.issues ?? []) {
        const p = i.fields.project?.key ?? '?';
        byProject[p] = (byProject[p] || 0) + 1;
        byType[i.fields.issuetype?.name] = (byType[i.fields.issuetype?.name] || 0) + 1;
    }
    const mine = await q('sprint = 521 AND assignee = currentUser()', 'project,issuetype');
    for (const i of mine?.issues ?? []) {
        const p = i.fields.project?.key ?? '?';
        byProjectMine[p] = (byProjectMine[p] || 0) + 1;
    }
    console.log(`sprint 521 总数 = ${all?.total}`);
    console.log('按项目: ' + JSON.stringify(byProject));
    console.log('按项目（我）: ' + JSON.stringify(byProjectMine));
    console.log('按类型: ' + JSON.stringify(byType));

    for (const p of ['MAGR3', 'NEX', 'NEX2', 'IB', 'PQ', 'ATD', 'VCP']) {
        const r = await q(`sprint = 521 AND project = ${p}`, 'summary');
        console.log(`  ${p.padEnd(6)} : ${r?.total ?? 'err'}`);
    }
})();
