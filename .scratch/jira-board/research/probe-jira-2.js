/**
 * 只读探针 2：补 02 号票缺的三块事实。
 *   A. 全部状态 id → 名称映射（列定义只给 id，卡片定位必须靠它）
 *   B. Epic Link / Rank 等自定义字段的真实 id
 *   C. 「In Progress → In Test」这条主路径的 transition 与实际必填字段
 *   D. 搜索分页行为（112 条 > maxResults 100）
 *
 * 跑法：node .scratch/jira-board/research/probe-jira-2.js
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

function describeTransitions(tr, label) {
    console.log(`\n=== ${label} ===`);
    for (const t of tr?.transitions ?? []) {
        const fk = Object.keys(t.fields ?? {});
        const req = fk.filter((k) => t.fields[k]?.required);
        console.log(`  ${t.id}: "${t.name}" → "${t.to?.name}"(id=${t.to?.id})  屏幕字段 ${fk.length} / 必填 ${req.length}`);
        for (const k of req) {
            const f = t.fields[k];
            console.log(`      REQUIRED ${k} (${f.name}) type=${f.schema?.type}${f.schema?.items ? '/' + f.schema.items : ''}${f.allowedValues ? ' allowed=' + f.allowedValues.length : ''}`);
        }
    }
}

(async () => {
    // A. 状态全表
    const statuses = await get('/rest/api/2/status');
    if (statuses) {
        console.log('=== A. 状态 id → 名称 ===');
        const rows = statuses.map((s) => `${s.id}=${s.name}(${s.statusCategory?.name})`);
        console.log('共 ' + statuses.length + ' 个状态');
        console.log(rows.join('  |  '));
    }

    // B. 自定义字段
    const fields = await get('/rest/api/2/field');
    if (fields) {
        console.log('\n=== B. 关键自定义字段 ===');
        const wanted = ['Epic Link', 'Epic Name', 'Rank', 'Sprint', 'Story Points', 'Story point estimate', 'Acceptance Criteria', 'Build', 'Release'];
        for (const f of fields) {
            if (wanted.some((w) => String(f.name).toLowerCase().includes(w.toLowerCase()))) {
                console.log(`  ${f.id} = "${f.name}" (${f.schema?.type ?? '-'}${f.schema?.custom ? ', custom=' + f.schema.custom : ''})`);
            }
        }
        console.log(`  字段总数 = ${fields.length}`);
    }

    // C. 主路径：找一个 In Progress 的 issue
    const jqlIp = encodeURIComponent('sprint = 521 AND status = "In Progress" ORDER BY updated DESC');
    const ip = await get(`/rest/api/2/search?jql=${jqlIp}&fields=summary,status&maxResults=3`);
    console.log('\n=== C. 主路径探测 ===');
    console.log(`In Progress 候选 = ${ip?.issues?.map((i) => `${i.key}[${i.fields.status.name}]`).join(', ') ?? '无'}`);
    const candidate = ip?.issues?.[0];
    if (candidate) {
        const tr = await get(`/rest/api/2/issue/${candidate.key}/transitions?expand=transitions.fields`);
        describeTransitions(tr, `${candidate.key} 在 In Progress 的可用 transitions`);
    }

    // C2. 找 In Test 的 issue，看回退路径
    const jqlIt = encodeURIComponent('sprint = 521 AND status = "In Test" ORDER BY updated DESC');
    const it = await get(`/rest/api/2/search?jql=${jqlIt}&fields=summary,status&maxResults=3`);
    console.log(`\nIn Test 候选 = ${it?.issues?.map((i) => i.key).join(', ') ?? '无'}`);
    if (it?.issues?.[0]) {
        const tr = await get(`/rest/api/2/issue/${it.issues[0].key}/transitions?expand=transitions.fields`);
        describeTransitions(tr, `${it.issues[0].key} 在 In Test 的可用 transitions`);
    }

    // D. 分页
    console.log('\n=== D. 分页 ===');
    const page2 = await get('/rest/api/2/search?jql=' + encodeURIComponent('sprint = 521') + '&fields=summary&startAt=100&maxResults=100');
    console.log(`startAt=100 → 返回 ${page2?.issues?.length ?? 0} 条, total=${page2?.total ?? '?'}`);
    const big = await get('/rest/api/2/search?jql=' + encodeURIComponent('sprint = 521') + '&fields=summary&maxResults=500');
    console.log(`maxResults=500 → 实际返回 ${big?.issues?.length ?? 0} 条, maxResults 回显=${big?.maxResults ?? '?'}`);
})();
