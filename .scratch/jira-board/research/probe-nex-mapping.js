/**
 * 只读探针：确认 NEX → nexus/dev/5.10.x 在 Jenkins 与 GitLab 两侧是否都存在。
 * 跑法：node .scratch/jira-board/research/probe-nex-mapping.js
 */
const https = require('https');
const { loadScrumBuddyConfig } = require('../../../out/services/ScrumBuddyConfig.js');

const cfg = loadScrumBuddyConfig();
const jk = cfg.jenkins;
const gl = cfg.gitlab;

function req(base, path, headers, timeoutMs = 30000) {
    return new Promise((resolve) => {
        const url = new URL(base + path);
        const isHttps = url.protocol === 'https:';
        const mod = isHttps ? https : require('http');
        const opts = {
            hostname: url.hostname, port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search, method: 'GET', headers, timeout: timeoutMs,
        };
        if (isHttps) opts.agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
        const r = mod.request(opts, (res) => {
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

const jkBase = String(jk.baseUrl).replace(/\/+$/, '');
const jkAuth = { Authorization: 'Basic ' + Buffer.from(`${jk.username}:${jk.token}`).toString('base64'), Accept: 'application/json' };

const glBase = String(gl.baseUrl).replace(/\/+$/, '');
const glAuth = { 'PRIVATE-TOKEN': gl.token, Accept: 'application/json' };

const seg = encodeURIComponent;

(async () => {
    console.log('=== A. Jenkins: gipc-app 下所有 nexus/* 分支 ===');
    const repoPath = `/job/${seg('UltrasoundGeneralImaging')}/job/${seg('ultrasoundgeneralimaging%2Fgipc-app')}/api/json?tree=jobs[name,color]`;
    const r = await req(jkBase, repoPath, jkAuth);
    const branches = (r.json?.jobs ?? []).map((b) => b.name);
    console.log(`分支总数 = ${branches.length}`);
    const nexusBranches = branches.filter((b) => /nexus/i.test(decodeURIComponent(b)));
    for (const b of nexusBranches) console.log(`  ${decodeURIComponent(b)}   (raw: ${b})`);

    const target = branches.find((b) => decodeURIComponent(b) === 'nexus/dev/5.10.x');
    console.log('\n  nexus/dev/5.10.x 是否存在: ' + (target ? '是 → ' + target : '否'));

    if (target) {
        const p = `/job/${seg('UltrasoundGeneralImaging')}/job/${seg('ultrasoundgeneralimaging%2Fgipc-app')}/job/${seg(target)}`;
        const lb = await req(jkBase, `${p}/api/json?tree=builds[number,result,timestamp,duration]`, jkAuth);
        console.log('\n=== B. 该分支最近 6 次构建 ===');
        for (const b of (lb.json?.builds ?? []).slice(0, 6)) {
            console.log(`  #${b.number} ${String(b.result).padEnd(8)} ${b.timestamp ? new Date(b.timestamp).toISOString().slice(0, 16) : '-'}  ${Math.round((b.duration || 0) / 60000)}min`);
        }
    }

    // 其他候选：别处是否也有 5.10.x
    console.log('\n=== C. 其它含 5.10 的分支 ===');
    for (const b of branches.filter((x) => /5\.10/.test(decodeURIComponent(x)))) {
        console.log('  ' + decodeURIComponent(b));
    }

    console.log('\n=== D. GitLab 侧 ===');
    console.log('  baseUrl = ' + glBase);
    console.log('  defaultProjectId = ' + gl.defaultProjectId);
    const proj = await req(glBase + '/api/v4/projects/' + encodeURIComponent(gl.defaultProjectId), { 'PRIVATE-TOKEN': gl.token, Accept: 'application/json' });
    if (proj.json) {
        console.log(`  项目: ${proj.json.path_with_namespace}  (id=${proj.json.id}, default_branch=${proj.json.default_branch})`);
        const br = await req(glBase + `/api/v4/projects/${proj.json.id}/repository/branches?search=nexus%2Fdev`, { 'PRIVATE-TOKEN': gl.token, Accept: 'application/json' });
        const list = Array.isArray(br.json) ? br.json : [];
        console.log(`  nexus/dev* 分支 ${list.length} 个:`);
        for (const b of list) console.log(`    ${b.name}  protected=${b.protected}  commit=${String(b.commit?.short_id)}`);
    } else {
        console.log('  取项目失败: HTTP ' + proj.status + ' ' + String(proj.text || proj.error).slice(0, 160));
    }
})();
