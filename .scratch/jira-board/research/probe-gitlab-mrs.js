/**
 * 只读探针：验证 MR 关联信号是否成立（分支名 / 标题 / 描述里有没有 NEX-xxx / NEX2-xxx）。
 * 跑法：node .scratch/jira-board/research/probe-gitlab-mrs.js
 */
const https = require('https');
const { loadScrumBuddyConfig } = require('../../../out/services/ScrumBuddyConfig.js');

const gl = loadScrumBuddyConfig().gitlab;
const base = String(gl.baseUrl).replace(/\/+$/, '');
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
const PROJECT = 90878;

function get(path, timeoutMs = 30000) {
    return new Promise((resolve) => {
        const url = new URL(base + path);
        const r = https.request({
            hostname: url.hostname, port: url.port || 443, path: url.pathname + url.search,
            method: 'GET', agent, headers: { 'PRIVATE-TOKEN': gl.token, Accept: 'application/json' }, timeout: timeoutMs,
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

const KEY = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/;
const enc = encodeURIComponent;

(async () => {
    console.log('=== A. 目标分支是否存在 ===');
    for (const b of ['nexus/dev/7.10.x', 'nexus/dev/5.10.x', 'nexus/maint/5.10.x', 'main']) {
        const r = await get(`/api/v4/projects/${PROJECT}/repository/branches/${enc(b)}`);
        console.log(`  ${b.padEnd(20)} ${r.json ? '✓ ' + String(r.json.commit?.short_id) + '  ' + String(r.json.commit?.committed_date).slice(0, 16) : 'HTTP ' + (r.status ?? r.error)}`);
    }

    console.log('\n=== B. 最近合并到 nexus/dev/7.10.x 的 MR（看关联信号）===');
    const mrs = await get(`/api/v4/projects/${PROJECT}/merge_requests?target_branch=${enc('nexus/dev/7.10.x')}&state=merged&per_page=12&order_by=updated_at`);
    const list = Array.isArray(mrs.json) ? mrs.json : [];
    console.log(`  命中 ${list.length} 个`);
    for (const m of list) {
        const inBranch = KEY.exec(m.source_branch || '');
        const inTitle = KEY.exec(m.title || '');
        const inDesc = KEY.exec(m.description || '');
        console.log(`  !${m.iid} [${String(m.merged_at).slice(0, 16)}] ${String(m.source_branch).slice(0, 55)}`);
        console.log(`       title: ${String(m.title).slice(0, 70)}`);
        console.log(`       key → branch=${inBranch?.[1] ?? '-'}  title=${inTitle?.[1] ?? '-'}  desc=${inDesc?.[1] ?? '-'}  approved_by=${(m.approved_by ?? []).length}`);
    }

    console.log('\n=== C. 最近合并到 nexus/dev/5.10.x 的 MR ===');
    const mrs5 = await get(`/api/v4/projects/${PROJECT}/merge_requests?target_branch=${enc('nexus/dev/5.10.x')}&state=merged&per_page=8&order_by=updated_at`);
    const list5 = Array.isArray(mrs5.json) ? mrs5.json : [];
    console.log(`  命中 ${list5.length} 个`);
    for (const m of list5) {
        const k = KEY.exec(m.source_branch || '')?.[1] ?? KEY.exec(m.title || '')?.[1] ?? '-';
        console.log(`  !${m.iid} [${String(m.merged_at).slice(0, 16)}] key=${k}  ${String(m.source_branch).slice(0, 50)}`);
    }

    console.log('\n=== D. 打开中的 MR 数量（判断轮询规模）===');
    for (const st of ['opened', 'merged']) {
        const r = await get(`/api/v4/projects/${PROJECT}/merge_requests?state=${st}&per_page=1`);
        console.log(`  state=${st}: 约 ${r.json?.[0] ? '有数据' : '无'}  (用 header 拿总数受限，仅采样)`);
    }
})();