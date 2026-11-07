/**
 * 只读探针 5：核实截图里的真实泳道语义。
 *   A. board 23 的 filter 是什么（截图只显示 6 个 issue，而 sprint 有 112 个）
 *   B. sprint 里的 epic 分布（截图泳道标题形如「NEX2 6 issues / Nexus R2」）
 *   C. 卡片上的 OB-Workflow 是什么字段
 *
 * 跑法：node .scratch/jira-board/research/probe-jira-5.js
 */
const { loadScrumBuddyConfig } = require('../../../out/services/ScrumBuddyConfig.js');

const cfg = loadScrumBuddyConfig();
const jira = cfg && cfg.jira;
const base = String(jira.baseUrl).replace(/\/+$/, '');
const auth = 'Basic ' + Buffer.from(`${jira.username}:${jira.password}`).toString('base64');

async function get(path) {
    const res = await fetch(base + path, { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    if (res.status >= 400) { console.log(`HTTP ${res.status} on ${path}: ${text.slice(0, 200)}`); return null; }
    try { return JSON.parse(text); } catch { return null; }
}

(async () => {
    // A. board filter
    const bcfg = await get('/rest/agile/1.0/board/23/configuration');
    const filter = bcfg?.filter;
    console.log('=== A. board 23 的 filter ===');
    console.log('board name = ' + (bcfg?.name ?? '?') + ', type = ' + (bcfg?.type ?? '?'));
    if (filter) {
        console.log(`filter id=${filter.id}`);
        const f = await get(`/rest/api/2/filter/${filter.id}`);
        console.log('filter name = ' + (f?.name ?? '?'));
        console.log('filter jql  = ' + (f?.jql ?? '?'));
    }

    // B. epic 分布
    console.log('\n=== B. sprint 521 的 epic 分布 ===');
    const ep = await get('/rest/api/2/search?jql=' + encodeURIComponent('sprint = 521 AND "Epic Link" is not EMPTY')
        + '&fields=customfield_10000,customfield_10002,status&maxResults=500');
    const groups = {};
    for (const i of ep?.issues ?? []) {
        const link = i.fields.customfield_10000;
        const key = typeof link === 'string' ? link : (link?.key ?? JSON.stringify(link));
        groups[key] = groups[key] || { n: 0, statuses: {} };
        groups[key].n++;
        const s = i.fields.status?.name ?? '?';
        groups[key].statuses[s] = (groups[key].statuses[s] || 0) + 1;
    }
    for (const [k, v] of Object.entries(groups).sort((a, b) => b[1].n - a[1].n)) {
        console.log(`  Epic ${k}: ${v.n} issues  ${JSON.stringify(v.statuses)}`);
    }

    // 找名为 Nexus R2 的 epic
    const nexus = await get('/rest/api/2/search?jql=' + encodeURIComponent('summary ~ "Nexus R2" OR "Epic Name" ~ "Nexus R2"') + '&fields=summary,issuetype,status&maxResults=10');
    console.log(`\n  搜 "Nexus R2" → total=${nexus?.total ?? 0}`);
    for (const i of nexus?.issues ?? []) {
        console.log(`    ${i.key} [${i.fields.issuetype?.name}] "${String(i.fields.summary).slice(0, 50)}" status=${i.fields.status?.name}`);
    }

    // C. OB-Workflow 是什么
    console.log('\n=== C. OB-Workflow 字段定位 ===');
    const ob = await get('/rest/api/2/search?jql=' + encodeURIComponent('sprint = 521 AND text ~ "OB-Workflow"') + '&fields=*all&maxResults=2');
    const sample = ob?.issues?.[0];
    if (sample) {
        console.log(`样本 ${sample.key}，字段总数 ${Object.keys(sample.fields).length}`);
        for (const [k, v] of Object.entries(sample.fields)) {
            const s = JSON.stringify(v);
            if (s && s.includes('OB-Workflow')) { console.log(`  命中字段 ${k} = ${s.slice(0, 200)}`); }
        }
    } else {
        console.log('  文本搜索未命中，改为在字段定义里找同名字段');
    }
    const fields = await get('/rest/api/2/field');
    for (const f of fields ?? []) {
        if (/workflow/i.test(String(f.name))) { console.log(`  字段候选 ${f.id} = "${f.name}" (${f.schema?.type})`); }
    }

    // D. 截图中 NEX2 泳道的 6 个 issue 是否都在 sprint 521
    console.log('\n=== D. 截图里的 4 个 issue 是否在 sprint 521 ===');
    for (const k of ['NEX2-777', 'NEX2-904', 'NEX2-776', 'NEX2-783']) {
        const r = await get(`/rest/api/2/issue/${k}?fields=status,customfield_10004,customfield_10000,parent`);
        const sprints = (r?.fields?.customfield_10004 ?? []).map((s) => s.name);
        console.log(`  ${k}: status=${r?.fields?.status?.name ?? '?'} sprint=${JSON.stringify(sprints)} epic=${JSON.stringify(r?.fields?.customfield_10000)}`);
    }
})();
