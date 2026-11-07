/**
 * 只读探针：Sub-task 的 workflow 是否允许直跳，以及 sprint 里子任务的实际状态分布。
 * 跑法：node .scratch/jira-board/research/probe-subtasks.js
 */
const { loadScrumBuddyConfig } = require('../../../out/services/ScrumBuddyConfig.js');

const cfg = loadScrumBuddyConfig();
const jira = cfg.jira;
const base = String(jira.baseUrl).replace(/\/+$/, '');
const auth = 'Basic ' + Buffer.from(`${jira.username}:${jira.password}`).toString('base64');

async function get(path) {
    const res = await fetch(base + path, { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
    const t = await res.text();
    if (res.status >= 400) { console.log(`HTTP ${res.status}: ${t.slice(0, 160)}`); return null; }
    try { return JSON.parse(t); } catch { return null; }
}

const enc = encodeURIComponent;

(async () => {
    const list = await get('/rest/api/2/search?jql=' + enc('sprint = 521 AND issuetype = Sub-task')
        + '&fields=summary,status,parent,assignee&maxResults=50');
    const subs = list?.issues ?? [];
    console.log(`=== Sub-task 总数 = ${list?.total} ===`);
    const byStatus = {};
    for (const s of subs) {
        const st = s.fields.status?.name ?? '?';
        byStatus[st] = (byStatus[st] || 0) + 1;
    }
    console.log('状态分布: ' + JSON.stringify(byStatus));
    for (const s of subs.slice(0, 6)) {
        console.log(`  ${s.key} [${s.fields.status?.name}] parent=${s.fields.parent?.key ?? '(无)'} ${String(s.fields.summary).slice(0, 45)}`);
    }

    if (!subs.length) return;

    for (const s of subs.slice(0, 3)) {
        const tr = await get(`/rest/api/2/issue/${s.key}/transitions?expand=transitions.fields`);
        console.log(`\n=== ${s.key} (${s.fields.status?.name}) 的可用 transition ===`);
        for (const t of tr?.transitions ?? []) {
            const fk = Object.keys(t.fields ?? {});
            const req = fk.filter((k) => t.fields[k]?.required);
            console.log(`  ${t.id} "${t.name}" → "${t.to?.name}"  必填=${req.join(',') || '无'}  屏幕字段=${fk.length}`);
        }
    }

    // 子任务能不能挂到自己的 MR：看分支命名通常用父任务 key，子任务自身 key 很少出现在分支里
    console.log('\n=== parent 与自身 key 对比（说明 MR 关联会挂到谁身上）===');
    for (const s of subs.slice(0, 5)) {
        console.log(`  ${s.key} → parent ${s.fields.parent?.key ?? '(无)'}`);
    }
})();
