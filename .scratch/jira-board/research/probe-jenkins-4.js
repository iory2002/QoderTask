/**
 * 只读探针：读取用户给出的 daily build job，确认 rev / changeSet / 参数是否可用于对齐。
 * job: UltrasoundGeneralImaging / ultrasoundgeneralimaging%2Fgipc-app / nexus%2Fdev%2F7.10.x
 * 跑法：node .scratch/jira-board/research/probe-jenkins-4.js
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
                try { resolve(JSON.parse(text)); } catch { console.log(`非 JSON ${path}: ${text.slice(0, 120)}`); resolve(null); }
            });
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', (e) => { console.log(`请求失败 ${path}: ${e.message}`); resolve(null); });
        req.end();
    });
}

// Jenkins 的 job 名里含字面 %2F，所以每段都要再编码一次
const seg = (name) => encodeURIComponent(name);
const ORG = 'UltrasoundGeneralImaging';
const REPO = 'ultrasoundgeneralimaging%2Fgipc-app';
const BRANCH = 'nexus%2Fdev%2F7.10.x';
const jobPath = `/job/${seg(ORG)}/job/${seg(REPO)}/job/${seg(BRANCH)}`;

const REV_TREE = 'actions[lastBuiltRevision[rev,branch[name]],parameters[name,value]]';

(async () => {
    console.log('=== A. 仓库下的分支 job ===');
    const repo = await get(`/job/${seg(ORG)}/job/${seg(REPO)}/api/json?tree=jobs[name,color]`);
    const branches = repo?.jobs ?? [];
    console.log(`分支数 = ${branches.length}`);
    for (const b of branches.slice(0, 20)) console.log(`  ${b.name}  color=${b.color}`);

    console.log('\n=== B. 用户给的那次构建 #243 ===');
    const b243 = await get(`${jobPath}/243/api/json?tree=number,result,timestamp,building,duration,${REV_TREE},changeSet[kind,items[commitId,msg,author[fullName]]]`);
    if (b243) {
        console.log(`  #${b243.number} ${b243.result}  ${b243.timestamp ? new Date(b243.timestamp).toISOString() : '-'}  ${Math.round((b243.duration || 0) / 1000)}s`);
        let foundRev = false;
        for (const a of b243.actions ?? []) {
            if (a.lastBuiltRevision) { foundRev = true; console.log('  lastBuiltRevision = ' + JSON.stringify(a.lastBuiltRevision)); }
            if (a.parameters?.length) console.log('  parameters = ' + JSON.stringify(a.parameters).slice(0, 500));
        }
        if (!foundRev) console.log('  → 无 lastBuiltRevision');
        const items = b243.changeSet?.items ?? [];
        console.log(`  changeSet 条目 = ${items.length}`);
        for (const it of items.slice(0, 5)) {
            console.log(`    ${String(it.commitId).slice(0, 10)}  ${String(it.msg).split('\n')[0].slice(0, 90)}`);
        }
    }

    console.log('\n=== C. 最近 8 次构建（rev 与结果） ===');
    const list = await get(`${jobPath}/api/json?tree=builds[number,result,timestamp,${REV_TREE}]`);
    for (const bl of (list?.builds ?? []).slice(0, 8)) {
        const revs = (bl.actions ?? []).map((a) => a.lastBuiltRevision?.rev).filter(Boolean);
        console.log(`  #${bl.number} ${String(bl.result).padEnd(8)} ${bl.timestamp ? new Date(bl.timestamp).toISOString().slice(0, 19) : '-'}  rev=${revs.join(',') || '(无)'}`);
    }

    console.log('\n=== D. 该分支 job 的 lastBuild ===');
    const lb = await get(`${jobPath}/lastBuild/api/json?tree=number,result,timestamp,${REV_TREE}`);
    console.log(`  #${lb?.number} ${lb?.result} ts=${lb?.timestamp ? new Date(lb.timestamp).toISOString() : '-'}`);

    console.log('\n=== E. 其他可能的分支（master / main） ===');
    const candidates = branches.filter((b) => /master|main|7\.10|release/i.test(b.name));
    console.log('  ' + (candidates.map((c) => c.name).join(', ') || '无'));
})();
