/**
 * 只读探针：为 06（构建 SHA 归因）确认三件事
 *   1) MR 列表里 merge_commit_sha 是否有值
 *   2) 该 merge commit 在 GitLab 侧有没有 Jenkins 回写的 commit status
 *   3) merge commit 与构建 SHA（#245 = 0d84325e…, #246 = 9d874314…）之间能否用 /repository/compare 建立祖先关系
 *
 * 跑法：node .scratch/devops-board/research/probe-gitlab-ancestry.js
 */
const https = require('https');
const { loadScrumBuddyConfig } = require('../../../out/services/ScrumBuddyConfig.js');

const cfg = loadScrumBuddyConfig();
const gl = cfg.gitlab;
const base = new URL(gl.baseUrl);
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
const PROJECT = 'ultrasoundgeneralimaging/gipc-app';
const TARGET = 'nexus/dev/7.10.x';
const BUILD_SHAS = { '#245': '0d84325ed3d3216fd09222bd7c1dfe60586f0a26', '#246': '9d87431453b874906ca0819f592af8c3d0dd4805' };

function get(path) {
    return new Promise((resolve) => {
        const req = https.request(
            {
                hostname: base.hostname,
                port: base.port || 443,
                path,
                method: 'GET',
                agent,
                headers: { 'PRIVATE-TOKEN': gl.token, Accept: 'application/json' },
                timeout: 25000,
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf-8');
                    try {
                        resolve({ status: res.statusCode, json: JSON.parse(text) });
                    } catch {
                        resolve({ status: res.statusCode, text: text.slice(0, 200) });
                    }
                });
            }
        );
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', (e) => resolve({ status: 0, text: e.message }));
        req.end();
    });
}

const enc = encodeURIComponent;

(async () => {
    const list = await get(
        `/api/v4/projects/${enc(PROJECT)}/merge_requests?state=merged&target_branch=${enc(TARGET)}&per_page=10&order_by=merged_at&sort=desc`
    );
    if (!Array.isArray(list.json)) {
        console.log('MR 列表失败', list.status, String(list.text ?? JSON.stringify(list.json)).slice(0, 200));
        return;
    }

    console.log(`=== 最近 10 个已合入 MR（target=${TARGET}） ===`);
    for (const mr of list.json) {
        console.log(
            `  !${String(mr.iid).padEnd(5)} merged_at=${String(mr.merged_at).slice(0, 16)}  merge_commit=${String(mr.merge_commit_sha).slice(0, 10)}  ${String(mr.title).slice(0, 40)}`
        );
    }

    const candidates = list.json.filter((mr) => mr.merge_commit_sha).slice(0, 3);
    console.log('\n=== 这些 merge commit 上的 Jenkins 状态（commit statuses） ===');
    for (const mr of candidates) {
        const st = await get(`/api/v4/projects/${enc(PROJECT)}/repository/commits/${mr.merge_commit_sha}/statuses`);
        if (Array.isArray(st.json)) {
            const jenkins = st.json.find((s) => /jenkins/i.test(s.name ?? ''));
            console.log(
                `  !${mr.iid} ${String(mr.merge_commit_sha).slice(0, 10)} → ${st.json.length} 条 status` +
                    (jenkins ? `，其中 jenkins: ${jenkins.status} ${String(jenkins.target_url ?? '').slice(-28)}` : '，无 jenkins 条目')
            );
        } else {
            console.log(`  !${mr.iid} → HTTP ${st.status}`);
        }
    }

    console.log('\n=== 祖先关系：merge commit 是否在构建 SHA 之前 ===');
    for (const mr of candidates) {
        const from = mr.merge_commit_sha;
        for (const [name, sha] of Object.entries(BUILD_SHAS)) {
            const cmp = await get(`/api/v4/projects/${enc(PROJECT)}/repository/compare?from=${from}&to=${sha}`);
            if (Array.isArray(cmp.json?.commits)) {
                console.log(
                    `  !${mr.iid} (${from.slice(0, 8)} ${String(mr.merged_at).slice(0, 16)}) ⊂ ${name} (${sha.slice(0, 8)}) ? ` +
                        `commits between = ${cmp.json.commits.length}`
                );
            } else {
                console.log(`  !${mr.iid} vs ${name}: HTTP ${cmp.status} ${String(cmp.text ?? JSON.stringify(cmp.json)).slice(0, 120)}`);
            }
        }
    }
})();
