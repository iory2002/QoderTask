/**
 * 只读探针：Jenkins 的 job 结构、构建是否记录 rev、分支维度。
 * 用 https 模块 + rejectUnauthorized:false（内网自签证书，对齐 GitLabService 的做法）。
 * 只发 GET。输出遮蔽凭据。
 * 跑法：node .scratch/jira-board/research/probe-jenkins.js
 */
const https = require('https');
const { loadScrumBuddyConfig } = require('../../../out/services/ScrumBuddyConfig.js');

const cfg = loadScrumBuddyConfig();
const jk = cfg && cfg.jenkins;
if (!jk) { console.log('!! 配置里没有 jenkins 段'); process.exit(0); }

const base = String(jk.baseUrl).replace(/\/+$/, '');
const auth = 'Basic ' + Buffer.from(`${jk.username}:${jk.token}`).toString('base64');
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

function get(path, timeoutMs = 25000) {
    return new Promise((resolve) => {
        const url = new URL(base + path);
        const req = https.request({
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname + url.search,
            method: 'GET',
            agent,
            headers: { Authorization: auth, Accept: 'application/json' },
            timeout: timeoutMs,
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf-8');
                if (res.statusCode >= 400) {
                    console.log(`HTTP ${res.statusCode} on ${path}: ${text.slice(0, 200).replace(/<[^>]+>/g, ' ')}`);
                    resolve(null); return;
                }
                try { resolve(JSON.parse(text)); } catch { console.log(`非 JSON (${path}): ${text.slice(0, 200)}`); resolve(null); }
            });
        });
        req.on('timeout', () => { req.destroy(new Error('timeout')); });
        req.on('error', (e) => { console.log(`请求失败 ${path}: ${e.message}`); resolve(null); });
        req.end();
    });
}

(async () => {
    console.log('baseUrl = ' + base);
    console.log('username = ' + String(jk.username).slice(0, 3) + '***');
    console.log('token 形态 = ' + (String(jk.token).startsWith('enc:') ? '未解密' : '已解密, 长度 ' + String(jk.token).length));

    const root = await get('/api/json?tree=jobs[name,url,color,_class]');
    if (!root) return;
    const jobs = root.jobs ?? [];
    console.log(`\n=== 顶层 job 数 = ${jobs.length} ===`);
    for (const j of jobs.slice(0, 30)) {
        console.log(`  [${(j._class || '').split('.').pop()}] ${j.name}  color=${j.color}`);
    }
    if (jobs.length > 30) console.log(`  ... 还有 ${jobs.length - 30} 个`);

    const containers = jobs.filter((j) => /Branch|Folder|MultiBranch/.test(j._class || ''));
    console.log(`\n=== 可展开的容器 = ${containers.length} 个: ${containers.slice(0, 10).map((c) => c.name).join(', ') || '无'} ===`);

    const folder = containers[0];
    if (folder) {
        const sub = await get(`/job/${encodeURIComponent(folder.name)}/api/json?tree=jobs[name,url,_class,color]`);
        const subs = sub?.jobs ?? [];
        console.log(`\n=== ${folder.name} 下 ${subs.length} 个子 job ===`);
        for (const s of subs.slice(0, 12)) console.log(`  [${(s._class || '').split('.').pop()}] ${s.name} color=${s.color}`);

        const branchJob = subs[0];
        if (branchJob) {
            const p = `/job/${encodeURIComponent(folder.name)}/job/${encodeURIComponent(branchJob.name)}/api/json`
                + '?tree=lastBuild[number,result,timestamp,actions[lastBuiltRevision[rev]]],builds[number,result,timestamp,actions[lastBuiltRevision[rev]]]';
            const b = await get(p);
            console.log(`\n=== ${folder.name}/${branchJob.name} ===`);
            if (b?.lastBuild) {
                const revs = (b.lastBuild.actions ?? []).map((a) => a.lastBuiltRevision?.rev).filter(Boolean);
                console.log(`  lastBuild #${b.lastBuild.number} ${b.lastBuild.result} rev=${revs.join(',') || '(无 lastBuiltRevision)'}`);
            } else {
                console.log('  lastBuild = 无');
            }
            for (const bl of (b?.builds ?? []).slice(0, 5)) {
                const revs = (bl.actions ?? []).map((a) => a.lastBuiltRevision?.rev).filter(Boolean);
                console.log(`    #${bl.number} ${bl.result} rev=${revs.join(',') || '(无 rev)'}`);
            }
        }
    } else {
        const j = jobs[0];
        if (j) {
            const b = await get(`/job/${encodeURIComponent(j.name)}/api/json?tree=lastBuild[number,result,timestamp,actions[lastBuiltRevision[rev]]],builds[number,result,timestamp,actions[lastBuiltRevision[rev]]]`);
            console.log(`\n=== 首个普通 job「${j.name}」===`);
            if (b?.lastBuild) {
                const revs = (b.lastBuild.actions ?? []).map((a) => a.lastBuiltRevision?.rev).filter(Boolean);
                console.log(`  lastBuild #${b.lastBuild.number} ${b.lastBuild.result} rev=${revs.join(',') || '(无 lastBuiltRevision)'}`);
            }
            for (const bl of (b?.builds ?? []).slice(0, 5)) {
                const revs = (bl.actions ?? []).map((a) => a.lastBuiltRevision?.rev).filter(Boolean);
                console.log(`    #${bl.number} ${bl.result} rev=${revs.join(',') || '(无 rev)'}`);
            }
        }
    }
})();
