/**
 * 只读探针：找「批量可读」的审批信号，避免每个 MR 一次 /approvals。
 * 对比列表字段 detailed_merge_status / merge_status / blocking_discussions_resolved 与 /approvals 的 approved。
 * 跑法：node .scratch/jira-board/research/probe-gitlab-approval-signal.js
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
                if (res.statusCode >= 400) { resolve({ status: res.statusCode, text }); return; }
                try { resolve({ status: res.statusCode, json: JSON.parse(text) }); } catch { resolve({ status: res.statusCode, text }); }
            });
        });
        r.on('timeout', () => r.destroy(new Error('timeout')));
        r.on('error', (e) => resolve({ error: e.message }));
        r.end();
    });
}

(async () => {
    console.log('=== A. 列表接口都返回了哪些 MR 字段 ===');
    const list = await get(`/api/v4/projects/${PROJECT}/merge_requests?state=opened&per_page=3&order_by=updated_at`);
    const sample = list.json?.[0];
    if (sample) {
        console.log('  字段: ' + Object.keys(sample).join(', '));
        console.log(`\n  detailed_merge_status = ${sample.detailed_merge_status}`);
        console.log(`  merge_status          = ${sample.merge_status}`);
        console.log(`  blocking_discussions_resolved = ${sample.blocking_discussions_resolved}`);
        console.log(`  has_conflicts = ${sample.has_conflicts ?? 'n/a'}  draft = ${sample.draft ?? sample.work_in_progress}`);
    }

    console.log('\n=== B. 列表 vs /approvals 对照（opened，逐个）===');
    let mismatch = 0;
    for (const m of list.json ?? []) {
        const a = await get(`/api/v4/projects/${PROJECT}/merge_requests/${m.iid}/approvals`);
        const ap = a.json ?? {};
        const bulkApproved = m.detailed_merge_status === 'not_approved' ? false : null;
        console.log(`  !${m.iid}  detailed=${String(m.detailed_merge_status).padEnd(22)} approved=${ap.approved}  required=${ap.approvals_required} left=${ap.approvals_left}  approved_by=${(ap.approved_by ?? []).length}人`);
        if (ap.approved_by?.length && ap.approvals_left > 0) mismatch++;
    }
    console.log(`\n  ⚠ 「有 approver 但 approvals_left>0」的样本数 = ${mismatch}`);

    console.log('\n=== C. 已合并 MR 的 detailed_merge_status ===');
    const merged = await get(`/api/v4/projects/${PROJECT}/merge_requests?state=merged&per_page=3`);
    for (const m of merged.json ?? []) {
        console.log(`  !${m.iid} detailed=${m.detailed_merge_status} state=${m.state} merged_at=${String(m.merged_at).slice(0, 16)}`);
    }

    console.log('\n=== D. 同一 issue 多个 MR：NEX2-932 的三个 ===');
    for (const iid of [3760, 3720, 3769]) {
        const d = await get(`/api/v4/projects/${PROJECT}/merge_requests/${iid}`);
        if (!d.json) { console.log(`  !${iid} 取不到`); continue; }
        const m = d.json;
        console.log(`  !${iid} state=${m.state} merged_at=${m.merged_at ?? '-'} source=${m.source_branch} 标题="${String(m.title).slice(0, 40)}"`);
    }
})();
