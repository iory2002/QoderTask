/**
 * 只读探针：验证 approved_by 到底是真的丢了，还是列表接口不返回。
 * 对比三个端点：列表 / 单个 MR 详情 / approvals 专端点。
 * 跑法：node .scratch/jira-board/research/probe-gitlab-approvals.js
 */
const https = require('https');
const { loadScrumBuddyConfig } = require('../../../out/services/ScrumBuddyConfig.js');

const gl = loadScrumBuddyConfig().gitlab;
const base = String(gl.baseUrl).replace(/\/+$/, '');
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
const PROJECT = 90878;

function get(path) {
    return new Promise((resolve) => {
        const url = new URL(base + path);
        const r = https.request({
            hostname: url.hostname, port: url.port || 443, path: url.pathname + url.search,
            method: 'GET', agent, headers: { 'PRIVATE-TOKEN': gl.token, Accept: 'application/json' }, timeout: 25000,
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf-8');
                if (res.statusCode >= 400) { resolve({ status: res.statusCode, text: text.slice(0, 200) }); return; }
                try { resolve({ status: res.statusCode, json: JSON.parse(text) }); } catch { resolve({ status: res.statusCode, text }); }
            });
        });
        r.on('timeout', () => r.destroy(new Error('timeout')));
        r.on('error', (e) => resolve({ error: e.message }));
        r.end();
    });
}

const short = (u) => (u ? u.name ?? u.username : '?');

(async () => {
    // 1) 列表接口里 approved_by 长什么样
    const list = await get(`/api/v4/projects/${PROJECT}/merge_requests?state=merged&per_page=5`);
    console.log('=== A. 列表接口 state=merged ===');
    for (const m of list.json ?? []) {
        console.log(`  !${m.iid} approved_by 字段存在=${'approved_by' in m} 值=${JSON.stringify((m.approved_by ?? []).map(short))}  approvals_before_merge=${m.approvals_before_merge ?? 'n/a'}`);
    }

    // 2) 单个 MR 详情
    const iid = list.json?.[0]?.iid ?? 3742;
    const detail = await get(`/api/v4/projects/${PROJECT}/merge_requests/${iid}`);
    console.log(`\n=== B. 单个 MR 详情 !${iid} ===`);
    if (detail.json) {
        const d = detail.json;
        console.log(`  state=${d.state}  merged_at=${d.merged_at}  merge_commit=${String(d.merge_commit_sha).slice(0, 10)}`);
        console.log(`  approved_by 存在=${'approved_by' in d} 值=${JSON.stringify((d.approved_by ?? []).map(short))}`);
        console.log(`  其它审批相关键: ${Object.keys(d).filter((k) => /approv|review/i.test(k)).join(', ') || '(无)'}`);
    } else {
        console.log('  HTTP ' + detail.status);
    }

    // 3) approvals 专端点
    const ap = await get(`/api/v4/projects/${PROJECT}/merge_requests/${iid}/approvals`);
    console.log(`\n=== C. approvals 专端点 !${iid} ===`);
    console.log('  ' + (ap.json ? JSON.stringify({
        approvals_required: ap.json.approvals_required,
        approvals_left: ap.json.approvals_left,
        approved_by: (ap.json.approved_by ?? []).map((a) => short(a.user)),
        approved: ap.json.approved,
    }) : `HTTP ${ap.status} ${String(ap.text).slice(0, 120)}`));

    // 4) 一个 opened 的 MR：列表 vs 专端点
    const open = await get(`/api/v4/projects/${PROJECT}/merge_requests?state=opened&per_page=5&order_by=updated_at`);
    console.log('\n=== D. state=opened 样本 ===');
    for (const m of open.json ?? []) {
        const a = await get(`/api/v4/projects/${PROJECT}/merge_requests/${m.iid}/approvals`);
        console.log(`  !${m.iid} 列表里 approved_by=${(m.approved_by ?? []).length} 人 | 专端点 approved_by=${(a.json?.approved_by ?? []).length} 人 (required=${a.json?.approvals_required}, left=${a.json?.approvals_left})`);
    }
})();
