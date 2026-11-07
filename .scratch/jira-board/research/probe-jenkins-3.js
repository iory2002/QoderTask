/**
 * 只读探针：在几个产品线 folder 里找 nexus / nex / magr / ib 相关 job。
 * 跑法：node .scratch/jira-board/research/probe-jenkins-3.js
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
                if (res.statusCode >= 400) { resolve({ status: res.statusCode }); return; }
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
    const folders = ['Mainline', 'R5', 'R4', 'LE9', 'Imaging_Team', 'GeminiPlus', 'Yahara'];
    const hits = [];
    for (const f of folders) {
        const r = await get(`/job/${enc(f)}/api/json?tree=jobs[name,_class]`);
        const jobs = r?.jobs ?? [];
        const matched = jobs.filter((j) => /nex|magr|^ib|nexus|ob.?gyn/i.test(j.name.replace(/%2F/gi, '/')));
        console.log(`${f.padEnd(12)} : ${String(jobs.length).padStart(3)} 个子 job${matched.length ? '，命中: ' + matched.map((m) => m.name).join(', ') : ''}`);
        for (const m of matched) hits.push(`${f}/${m.name}`);
    }
    console.log('\n命中汇总: ' + (hits.join(' | ') || '无'));
    if (!hits.length) {
        const r = await get('/job/Mainline/api/json?tree=jobs[name]');
        console.log('Mainline 前 30 个名字: ' + (r?.jobs ?? []).slice(0, 30).map((j) => j.name).join(', '));
    }
})();
