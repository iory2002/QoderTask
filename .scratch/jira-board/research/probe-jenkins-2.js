/**
 * 只读探针：在 Jenkins 的 OrganizationFolder 里找 NEX2 / NEX / MAGR3 / IB 相关仓库 job，
 * 并检查构建里到底有没有可用于对齐的 rev / 分支参数。
 * 跑法：node .scratch/jira-board/research/probe-jenkins-2.js
 */
const https = require('https');
const { loadScrumBuddyConfig } = require('../../../out/services/ScrumBuddyConfig.js');

const cfg = loadScrumBuddyConfig();
const jk = cfg.jenkins;
const base = String(jk.baseUrl).replace(/\/+$/, '');
const auth = 'Basic ' + Buffer.from(`${jk.username}:${jk.token}`).toString('base64');
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

function get(path, timeoutMs = 30000) {
    return new Promise((resolve) => {
        const url = new URL(base + path);
        const req = https.request({
            hostname: url.hostname, port: url.port || 443, path: url.pathname + url.search,
            method: 'GET', agent, headers: { Authorization: auth, Accept: 'application/json' }, timeout: timeoutMs,
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf-8');
                if (res.statusCode >= 400) { console.log(`HTTP ${res.statusCode} ${path}`); resolve(null); return; }
                try { resolve(JSON.parse(text)); } catch { resolve(null); }
            });
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', (e) => { console.log(`请求失败 ${path}: ${e.message}`); resolve(null); });
        req.end();
    });
}

const enc = encodeURIComponent;

(async () => {
    for (const org of ['ultrasound', 'UltrasoundGeneralImaging']) {
        const r = await get(`/job/${enc(org)}/api/json?tree=jobs[name,_class,url]`);
        const jobs = r?.jobs ?? [];
        console.log(`\n=== ${org}: ${jobs.length} 个仓库 ===`);
        const hits = jobs.filter((j) => /nex|magr|^ib-|nexus/i.test(j.name));
        console.log('  命中: ' + (hits.map((h) => h.name).join(', ') || '无'));
        if (!hits.length) {
            console.log('  前 20 个名字: ' + jobs.slice(0, 20).map((j) => j.name).join(', '));
            continue;
        }
        const target = hits[0];
        console.log(`\n--- 检查 ${org}/${target.name} ---`);
        // 分支维度
        const branches = await get(`/job/${enc(org)}/job/${enc(target.name)}/api/json?tree=jobs[name,color]`);
        console.log('  分支 job: ' + ((branches?.jobs ?? []).map((b) => b.name).join(', ') || '(无，非 multibranch)'));

        const branchName = (branches?.jobs ?? [])[0]?.name;
        const path = branchName
            ? `/job/${enc(org)}/job/${enc(target.name)}/job/${enc(branchName)}`
            : `/job/${enc(org)}/job/${enc(target.name)}`;

        const detail = await get(`${path}/lastBuild/api/json?tree=number,result,timestamp,building,actions[lastBuiltRevision[rev,branch[name]],parameters[name,value]]`);
        console.log(`  lastBuild: #${detail?.number} ${detail?.result} ts=${detail?.timestamp ? new Date(detail.timestamp).toISOString() : '-'}`);
        for (const a of detail?.actions ?? []) {
            if (a.lastBuiltRevision) console.log('    lastBuiltRevision = ' + JSON.stringify(a.lastBuiltRevision));
            if (a.parameters) console.log('    parameters = ' + JSON.stringify(a.parameters).slice(0, 400));
        }
        if (!detail?.actions?.some((a) => a.lastBuiltRevision)) console.log('    → 无 lastBuiltRevision');

        const cs = await get(`${path}/lastBuild/api/json?tree=changeSet[kind,items[commitId,msg]]`);
        const items = cs?.changeSet?.items ?? [];
        console.log(`  changeSet 条目 = ${items.length}` + (items[0] ? ` ，首条 commitId=${items[0].commitId}` : ''));
    }
})();
