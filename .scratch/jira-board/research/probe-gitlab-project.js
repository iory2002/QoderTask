/**
 * 只读探针：在 GitLab 上定位 gipc-app 仓库，并确认 nexus/dev/5.10.x 与 7.10.x 的 MR 情况。
 * 跑法：node .scratch/jira-board/research/probe-gitlab-project.js
 */
const https = require('https');
const { loadScrumBuddyConfig } = require('../../../out/services/ScrumBuddyConfig.js');

const gl = loadScrumBuddyConfig().gitlab;
const base = String(gl.baseUrl).replace(/\/+$/, '');
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

function get(path, timeoutMs = 25000) {
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

(async () => {
    console.log('baseUrl = ' + base);
    console.log('token 形态 = ' + (String(gl.token).startsWith('enc:') ? '未解密' : '已解密, 长度 ' + String(gl.token).length));

    console.log('\n=== A. 用路径直接取仓库 ===');
    for (const p of ['ultrasoundgeneralimaging/gipc-app', 'ultrasoundgeneralimaging%2Fgipc-app']) {
        const r = await get('/api/v4/projects/' + encodeURIComponent(p));
        console.log(`  ${p} → ${r.status ?? r.error}${r.json ? '  ✓ ' + r.json.path_with_namespace + ' id=' + r.json.id : ''}`);
    }

    console.log('\n=== B. 搜索 gipc / nexus ===');
    for (const q of ['gipc', 'gipc-app', 'nexus']) {
        const r = await get(`/api/v4/projects?search=${encodeURIComponent(q)}&per_page=10&simple=true`);
        const list = Array.isArray(r.json) ? r.json : [];
        console.log(`  search="${q}" → ${r.status ?? r.error}, 命中 ${list.length}`);
        for (const p of list.slice(0, 6)) console.log(`    ${p.id}  ${p.path_with_namespace}  default=${p.default_branch}`);
    }

    console.log('\n=== C. 当前用户与可用 token 权限 ===');
    const me = await get('/api/v4/user');
    console.log('  ' + (me.json ? `${me.json.username} (id=${me.json.id})` : `HTTP ${me.status} ${String(me.text).slice(0, 120)}`));
})();