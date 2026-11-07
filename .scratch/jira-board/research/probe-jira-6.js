/**
 * 只读探针 6：纠正上一轮的解析错误，并确认截图对应哪个 sprint。
 *   A. board 23 的全部 sprint（id / 名称 / 状态）
 *   B. 截图里 4 张卡的 Sprint 字段原始 JSON
 *   C. 这些卡是否落在 sprint 521 里
 *
 * 跑法：node .scratch/jira-board/research/probe-jira-6.js
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
    const sp = await get('/rest/agile/1.0/board/23/sprint?maxResults=50');
    console.log('=== A. board 23 的 sprint ===');
    for (const s of sp?.values ?? []) {
        console.log(`  ${s.id}  [${s.state}]  "${s.name}"  start=${s.startDate ?? '-'} end=${s.endDate ?? '-'}`);
    }

    console.log('\n=== B/C. 截图里的 4 张卡 ===');
    for (const k of ['NEX2-777', 'NEX2-904', 'NEX2-776', 'NEX2-783']) {
        const r = await get(`/rest/api/2/issue/${k}?fields=status,customfield_10004,customfield_10000`);
        if (!r) continue;
        const sprintField = r.fields.customfield_10004;
        console.log(`  ${k}: status=${r.fields.status?.name}`);
        console.log(`      Epic Link = ${JSON.stringify(r.fields.customfield_10000)}`);
        console.log(`      Sprint raw = ${JSON.stringify(sprintField).slice(0, 300)}`);
    }

    // 直接用 JQL 反查，避免解析问题
    console.log('\n=== C2. JQL 反查 ===');
    for (const k of ['NEX2-777', 'NEX2-904', 'NEX2-776', 'NEX2-783']) {
        const r = await get('/rest/api/2/search?jql=' + encodeURIComponent(`key = ${k} AND sprint = 521`) + '&fields=summary&maxResults=1');
        console.log(`  ${k} in sprint 521 ? total=${r?.total ?? 'err'}`);
    }
    const in521 = await get('/rest/api/2/search?jql=' + encodeURIComponent('sprint = 521 AND project = NEX2') + '&fields=summary&maxResults=1');
    console.log(`  sprint 521 里 NEX2 项目的 issue 数 = ${in521?.total ?? 'err'}`);
})();
