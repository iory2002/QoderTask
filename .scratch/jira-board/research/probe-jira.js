/**
 * 只读探针：拿真实 Jira 的端点契约形状，供 02 号决策票使用。
 * 只发 GET，不写任何数据。输出里遮蔽凭据与 issue 正文。
 *
 * 跑法：node .scratch/jira-board/research/probe-jira.js [ISSUE_KEY]
 */
const { loadScrumBuddyConfig } = require('../../../out/services/ScrumBuddyConfig.js');

function head(s, n = 160) {
    const t = String(s).replace(/\s+/g, ' ');
    return t.length > n ? t.slice(0, n) + ' …' : t;
}

function tryParse(text) {
    try { return JSON.parse(text); } catch { return null; }
}

const cfg = loadScrumBuddyConfig();
const jira = cfg && cfg.jira;
if (!jira) {
    console.log('!! 配置里没有 jira 段，无法探测');
    process.exit(0);
}

const base = String(jira.baseUrl).replace(/\/+$/, '');
const auth = 'Basic ' + Buffer.from(`${jira.username}:${jira.password}`).toString('base64');
const boardId = jira.defaultBoardId || 23;

console.log(`baseUrl = ${base}`);
console.log(`username = ${String(jira.username).slice(0, 3)}***`);
console.log(`password 形态 = ${String(jira.password).startsWith('enc:') ? '未解密(enc:)' : '已解密, 长度 ' + String(jira.password).length}`);
console.log(`defaultBoardId = ${boardId}`);
console.log('');

async function get(path, label) {
    const started = Date.now();
    try {
        const res = await fetch(base + path, {
            headers: { Authorization: auth, Accept: 'application/json' },
            signal: AbortSignal.timeout(15000),
        });
        const text = await res.text();
        const ms = Date.now() - started;
        console.log(`--- ${label} ---`);
        console.log(`GET ${path}`);
        console.log(`HTTP ${res.status} (${ms}ms, ${text.length} bytes, ctype=${res.headers.get('content-type')})`);
        if (res.status >= 400) {
            console.log(`body: ${head(text, 300)}`);
            return null;
        }
        return tryParse(text);
    } catch (err) {
        console.log(`--- ${label} ---`);
        console.log(`GET ${path}`);
        console.log(`网络/超时失败: ${err.message}`);
        return null;
    }
}

(async () => {
    // 1) 身份
    const me = await get('/rest/api/2/myself', '1. 身份校验');
    if (me) {
        console.log(`有 displayName: ${typeof me.displayName === 'string'}, 有 emailAddress: ${typeof me.emailAddress === 'string'}`);
        console.log(`timeZone: ${me.timeZone ?? '(null)'}`);
    }

    // 2) 列定义
    const bcfg = await get(`/rest/agile/1.0/board/${boardId}/configuration`, '2. board configuration');
    if (bcfg) {
        console.log('顶层键: ' + Object.keys(bcfg).join(', '));
        const cols = bcfg.columnConfig?.columns ?? [];
        console.log(`columnConfig.columns.length = ${cols.length}`);
        cols.forEach((c) => {
            const names = (c.statuses ?? []).map((s) => `#${s.id}`).join(',');
            console.log(`  列「${c.name}」statusIds=[${names}] min=${c.min ?? '-'} max=${c.max ?? '-'}`);
        });
        console.log(`有 filter: ${!!bcfg.filter}, 有 ranking: ${!!bcfg.ranking}`);
        if (bcfg.ranking) { console.log('ranking 字段名: ' + JSON.stringify(bcfg.ranking).slice(0, 200)); }
    }

    // 3) 活跃 sprint
    const sprints = await get(`/rest/agile/1.0/board/${boardId}/sprint?state=active`, '3. 活跃 sprint');
    const sprintId = sprints?.values?.[0]?.id;
    if (sprints) {
        console.log(`活跃 sprint 数 = ${sprints.values?.length ?? 0}, id=${sprintId ?? 'null'}`);
    }

    if (!sprintId) {
        console.log('\n没有活跃 sprint，后续搜索与 transitions 探测跳过');
        return;
    }

    // 4) 搜索：对比「排除 Done」与「含 Done」
    const jqlExcl = encodeURIComponent(`sprint = ${sprintId} AND assignee = currentUser() AND status not in (Resolved, Closed, Done)`);
    const jqlAll = encodeURIComponent(`sprint = ${sprintId}`);
    const fields = 'summary,status,issuetype,priority,updated';

    const excl = await get(`/rest/api/2/search?jql=${jqlExcl}&fields=${fields}&maxResults=1`, '4a. 现行 JQL（排除 Done）');
    const all = await get(`/rest/api/2/search?jql=${jqlAll}&fields=${fields}&maxResults=100`, '4b. 全 sprint（含 Done）');

    if (excl) console.log(`现行 JQL total = ${excl.total} (返回 ${excl.issues?.length ?? 0} 条)`);
    if (all) {
        console.log(`全 sprint total = ${all.total} (返回 ${all.issues?.length ?? 0} 条), startAt=${all.startAt}, maxResults=${all.maxResults}`);
        const byStatus = {};
        for (const it of all.issues ?? []) {
            const s = it.fields?.status?.name ?? '(none)';
            byStatus[s] = (byStatus[s] || 0) + 1;
        }
        console.log('状态分布: ' + JSON.stringify(byStatus));
        const noKeyCount = (all.issues ?? []).filter((i) => !i.key).length;
        console.log(`缺 key 的条目数 = ${noKeyCount}`);
        const sample = (all.issues ?? [])[0];
        if (sample) {
            console.log(`样例 key = ${sample.key}, 字段键 = ${Object.keys(sample.fields ?? {}).join(',')}`);
            console.log(`status 对象键 = ${Object.keys(sample.fields?.status ?? {}).join(',')}, statusCategory = ${sample.fields?.status?.statusCategory?.name ?? '(none)'}`);
        }
    }

    // 5) transitions 元数据
    const issueKey = process.argv[2] || (all?.issues ?? [])[0]?.key;
    if (!issueKey) { console.log('\n拿不到 issue key，transitions 探测跳过'); return; }

    const tr = await get(`/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions?expand=transitions.fields`, `5. transitions (${issueKey})`);
    if (tr) {
        const list = tr.transitions ?? [];
        console.log(`可用 transition 数 = ${list.length}`);
        for (const t of list) {
            const fieldKeys = Object.keys(t.fields ?? {});
            const required = fieldKeys.filter((k) => t.fields[k]?.required);
            console.log(`  id=${t.id} name="${t.name}" → to="${t.to?.name}"(id=${t.to?.id})`);
            console.log(`     屏幕字段=${fieldKeys.length} 个, 必填=${required.length} 个${required.length ? ' → ' + required.join(',') : ''}`);
            for (const k of required.slice(0, 4)) {
                const f = t.fields[k];
                console.log(`     · ${k}: schema.type=${f.schema?.type}/${f.schema?.items ?? '-'}, name="${f.name}", allowed=${f.allowedValues ? f.allowedValues.length : 'n/a'}`);
            }
        }
        const allFieldKeys = new Set();
        for (const t of list) { for (const k of Object.keys(t.fields ?? {})) { allFieldKeys.add(k); } }
        console.log(`全部出现过的屏幕字段 = ${[...allFieldKeys].join(', ') || '(无)'}`);
    }

    // 6) 单 issue 全字段（看 epic link / rank 是否存在）
    const one = await get(`/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=summary,status,customfield_10000,customfield_10001,customfield_10002,updated,issuetype,priority,parent`, '6. 单 issue 字段抽样');
    if (one?.fields) {
        const keys = Object.keys(one.fields);
        console.log(`返回字段数 = ${keys.length}: ${keys.join(', ')}`);
        for (const k of keys) {
            if (k.startsWith('customfield_')) {
                const v = one.fields[k];
                const t = v === null ? 'null' : typeof v === 'object' ? JSON.stringify(v).slice(0, 120) : String(v).slice(0, 60);
                console.log(`  ${k} = ${t}`);
            }
        }
    }
})();
