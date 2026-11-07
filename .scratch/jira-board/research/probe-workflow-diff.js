/**
 * 只读探针：同样是 In Progress，为什么 NEX2-980 只能 Review Code，而 NEX2-1044 能 Send to Test。
 * 假设：issue type（或子类型）不同导致 workflow 不同。
 * 跑法：node .scratch/jira-board/research/probe-workflow-diff.js
 */
const { loadScrumBuddyConfig } = require('../../../out/services/ScrumBuddyConfig.js');

const cfg = loadScrumBuddyConfig();
const jira = cfg.jira;
const base = String(jira.baseUrl).replace(/\/+$/, '');
const auth = 'Basic ' + Buffer.from(`${jira.username}:${jira.password}`).toString('base64');

async function get(path) {
    const res = await fetch(base + path, { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
    const t = await res.text();
    if (res.status >= 400) return null;
    try { return JSON.parse(t); } catch { return null; }
}
const enc = encodeURIComponent;

async function inspect(key) {
    const i = await get(`/rest/api/2/issue/${key}?fields=summary,status,issuetype,parent,priority`);
    const tr = await get(`/rest/api/2/issue/${key}/transitions`);
    console.log(`\n--- ${key} ---`);
    console.log(`  type=${i?.fields?.issuetype?.name}  status=${i?.fields?.status?.name}  parent=${i?.fields?.parent?.key ?? '-'}`);
    console.log(`  ${String(i?.fields?.summary).slice(0, 60)}`);
    console.log('  transitions: ' + ((tr?.transitions ?? []).map((t) => `${t.name}→${t.to?.name}`).join(' | ') || '(无)'));
}

(async () => {
    for (const k of ['NEX2-980', 'NEX2-1044', 'NEX2-904', 'NEX2-776', 'NEX2-765', 'NEX2-756', 'NEX2-1064']) {
        await inspect(k);
    }

    // 按 issue type 统计 sprint 里的分布 + 每种类型在 In Progress 的出口
    console.log('\n=== 各 issue type 在 In Progress 的出口（每类型取一个样本） ===');
    for (const type of ['Bug', 'Story', 'Task', 'In-Sprint Bug']) {
        const r = await get('/rest/api/2/search?jql=' + enc(`sprint = 521 AND issuetype = "${type}" AND status = "In Progress"`) + '&fields=summary&maxResults=1');
        const key = r?.issues?.[0]?.key;
        if (!key) { console.log(`  ${type}: 无样本`); continue; }
        const tr = await get(`/rest/api/2/issue/${key}/transitions`);
        console.log(`  ${type} (${key}): ` + ((tr?.transitions ?? []).map((t) => `${t.name}→${t.to?.name}`).join(' | ') || '(无)'));
    }
})();
