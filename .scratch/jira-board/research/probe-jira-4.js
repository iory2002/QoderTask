/**
 * 只读探针 4：补最后三个洞。
 *   A. In Review 的出口（本 sprint 没样本，改为全局找）
 *   B. Epic Link 的实际填充率（决定 epic 泳道是否有意义）
 *   C. Build / Verify Build Number 字段是否可用于预填
 *
 * 跑法：node .scratch/jira-board/research/probe-jira-4.js
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

async function transitionsFor(jql, label) {
    const s = await get(`/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=summary,status&maxResults=3`);
    const issues = s?.issues ?? [];
    console.log(`\n=== ${label}: total=${s?.total ?? 0} 样本=${issues.map((i) => `${i.key}(${i.fields.status.name})`).join(', ') || '无'} ===`);
    if (!issues.length) return;
    const tr = await get(`/rest/api/2/issue/${issues[0].key}/transitions?expand=transitions.fields`);
    for (const t of tr?.transitions ?? []) {
        const fk = Object.keys(t.fields ?? {});
        const req = fk.filter((k) => t.fields[k]?.required);
        console.log(`  ${t.id} "${t.name}" → "${t.to?.name}"(id=${t.to?.id})  必填=${req.join(',') || '无'}  屏幕=${fk.length} [${fk.join(',')}]`);
    }
}

(async () => {
    await transitionsFor('status = "In Review" ORDER BY updated DESC', 'A1 全局 In Review');
    await transitionsFor('status = "In Review" AND assignee = currentUser() ORDER BY updated DESC', 'A2 我的 In Review');
    await transitionsFor('status = "Open" AND assignee = currentUser() ORDER BY updated DESC', 'A3 Open 的出口');

    // B. epic 填充率
    const withEpic = await get('/rest/api/2/search?jql=' + encodeURIComponent('sprint = 521 AND "Epic Link" is not EMPTY') + '&fields=summary&maxResults=1');
    const noEpic = await get('/rest/api/2/search?jql=' + encodeURIComponent('sprint = 521 AND "Epic Link" is EMPTY') + '&fields=summary&maxResults=1');
    console.log(`\n=== B. Epic 填充率（sprint 521）===`);
    console.log(`  有 Epic Link: ${withEpic?.total ?? 'err'} 条`);
    console.log(`  无 Epic Link: ${noEpic?.total ?? 'err'} 条`);

    // C. Build 字段可用性
    const it = await get('/rest/api/2/search?jql=' + encodeURIComponent('sprint = 521 AND status = "In Test"') + '&fields=summary,customfield_10102,customfield_12300&maxResults=3');
    console.log(`\n=== C. Build 字段（In Test 样本）===`);
    for (const i of it?.issues ?? []) {
        console.log(`  ${i.key}: Build=${JSON.stringify(i.fields.customfield_10102)} VerifyBuild=${JSON.stringify(i.fields.customfield_12300)}`);
    }

    // D. issue type 分布（决定 issue-type 泳道）
    const types = await get('/rest/api/2/search?jql=' + encodeURIComponent('sprint = 521') + '&fields=issuetype&maxResults=500');
    const byType = {};
    for (const i of types?.issues ?? []) { const n = i.fields.issuetype?.name ?? '?'; byType[n] = (byType[n] || 0) + 1; }
    console.log(`\n=== D. issue type 分布 = ${JSON.stringify(byType)} ===`);
})();
