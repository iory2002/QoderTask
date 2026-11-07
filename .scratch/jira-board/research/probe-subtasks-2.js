/**
 * 只读探针：In Progress 的 Sub-task 能往哪走（验证用户说的“可直达 In Test/Resolved”）。
 * 跑法：node .scratch/jira-board/research/probe-subtasks-2.js
 */
const { loadScrumBuddyConfig } = require('../../../out/services/ScrumBuddyConfig.js');

const cfg = loadScrumBuddyConfig();
const jira = cfg.jira;
const base = String(jira.baseUrl).replace(/\/+$/, '');
const auth = 'Basic ' + Buffer.from(`${jira.username}:${jira.password}`).toString('base64');

async function get(path) {
    const res = await fetch(base + path, { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
    const t = await res.text();
    if (res.status >= 400) { console.log(`HTTP ${res.status}`); return null; }
    try { return JSON.parse(t); } catch { return null; }
}
const enc = encodeURIComponent;

(async () => {
    const list = await get('/rest/api/2/search?jql=' + enc('sprint = 521 AND issuetype = Sub-task AND status = "In Progress"')
        + '&fields=summary,status,parent&maxResults=20');
    const subs = list?.issues ?? [];
    console.log(`=== In Progress 的子任务 = ${subs.length} ===`);
    for (const s of subs) console.log(`  ${s.key} parent=${s.fields.parent?.key ?? '-'} ${String(s.fields.summary).slice(0, 40)}`);

    for (const s of subs) {
        const tr = await get(`/rest/api/2/issue/${s.key}/transitions?expand=transitions.fields`);
        console.log(`\n=== ${s.key} (${s.fields.status?.name}) ===`);
        for (const t of tr?.transitions ?? []) {
            const fk = Object.keys(t.fields ?? {});
            const req = fk.filter((k) => t.fields[k]?.required);
            console.log(`  ${t.id} "${t.name}" → "${t.to?.name}"  必填=${req.join(',') || '无'}  屏幕=${fk.length}`);
        }
    }

    // 对照：普通 issue 在同一项目下 In Progress 的出口（已知只有 Review Code / Return）
    const one = await get('/rest/api/2/search?jql=' + enc('sprint = 521 AND issuetype in (Task, Bug, Story) AND status = "In Progress"') + '&fields=summary,status&maxResults=1');
    const k = one?.issues?.[0]?.key;
    if (k) {
        const tr = await get(`/rest/api/2/issue/${k}/transitions`);
        console.log(`\n=== 对照：${k} 普通类型 In Progress 的出口 ===`);
        for (const t of tr?.transitions ?? []) console.log(`  ${t.id} "${t.name}" → "${t.to?.name}"`);
    }
})();
