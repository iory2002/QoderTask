/**
 * 只读探针：确认「构建 → commit」到底有没有可用的锚点。
 *
 * 背景：03-jenkins-mapping.md 的结论是 lastBuiltRevision 无 rev、changeSet 为空，
 * 只能按时间窗归因。本探针只回答一个问题：那是 MCP/探针没问到，还是 Jenkins 侧确实没有？
 *
 * 跑法：node .scratch/devops-board/research/probe-jenkins-attribution.js
 */
const https = require('https');
const { loadScrumBuddyConfig } = require('../../../out/services/ScrumBuddyConfig.js');

const cfg = loadScrumBuddyConfig();
const jk = cfg.jenkins;
const gl = cfg.gitlab;
const jkBase = String(jk.baseUrl).replace(/\/+$/, '');
const glBase = String(gl.baseUrl).replace(/\/+$/, '');
const jkAuth = 'Basic ' + Buffer.from(`${jk.username}:${jk.token}`).toString('base64');
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
const seg = encodeURIComponent;
const jobPath = `/job/${seg('UltrasoundGeneralImaging')}/job/${seg('ultrasoundgeneralimaging%2Fgipc-app')}/job/${seg('nexus%2Fdev%2F7.10.x')}`;

function getJson(url, headers) {
    return new Promise((resolve) => {
        const u = new URL(url);
        const req = https.request(
            {
                hostname: u.hostname,
                port: u.port || 443,
                path: u.pathname + u.search,
                method: 'GET',
                agent,
                headers: { Accept: 'application/json', ...headers },
                timeout: 25000,
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf-8');
                    if (res.statusCode >= 400) {
                        resolve({ status: res.statusCode, body: text.slice(0, 200) });
                        return;
                    }
                    try {
                        resolve({ status: res.statusCode, json: JSON.parse(text) });
                    } catch {
                        resolve({ status: res.statusCode, body: text.slice(0, 200) });
                    }
                });
            }
        );
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', (e) => resolve({ status: 0, body: String(e.message) }));
        req.end();
    });
}

/** 只读前 capBytes 的 console 文本，避免把 16 小时的日志整个拉下来 */
function getConsoleHead(url, capBytes = 2_000_000) {
    return new Promise((resolve) => {
        const u = new URL(url);
        const req = https.request(
            {
                hostname: u.hostname,
                port: u.port || 443,
                path: u.pathname + u.search,
                method: 'GET',
                agent,
                headers: { Authorization: jkAuth },
                timeout: 60000,
            },
            (res) => {
                const chunks = [];
                let size = 0;
                res.on('data', (c) => {
                    chunks.push(c);
                    size += c.length;
                    if (size > capBytes) {
                        req.destroy();
                        resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf-8') });
                    }
                });
                res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf-8') }));
            }
        );
        req.on('timeout', () => {
            req.destroy();
            resolve({ status: 0, text: '' });
        });
        req.on('error', () => resolve({ status: 0, text: Buffer.concat([]).toString('utf-8') }));
        req.end();
    });
}

(async () => {
    console.log('=== A. 构建详情里所有 action 的 _class（看有没有 Git 插件数据） ===');
    for (const n of [246, 245]) {
        const r = await getJson(`${jkBase}${jobPath}/${n}/api/json?tree=number,result,building,actions[_class,lastBuiltRevision[SHA1,branch[SHA1,name],revision[SHA1,markup]],parameters[name,value],remoteUrls,mercurialRevisionNumber]`, {
            Authorization: jkAuth,
        });
        if (!r.json) {
            console.log(`  #${n}: 取不到 (${r.status} ${r.body ?? ''})`);
            continue;
        }
        console.log(`  #${n} result=${r.json.result} building=${r.json.building}`);
        for (const a of r.json.actions ?? []) {
            const keys = Object.keys(a).filter((k) => k !== '_class');
            if (keys.length > 0) {
                console.log(`    ${a._class}  ->  ${JSON.stringify(a).slice(0, 300)}`);
            }
        }
    }

    console.log('\n=== B. changeSet 专用端点 ===');
    const cs = await getJson(`${jkBase}${jobPath}/245/changeSet/api/json?tree=items[commitId,msg,author[fullName],date]`, { Authorization: jkAuth });
    console.log('  ' + JSON.stringify(cs.json ?? cs.body ?? cs.status).slice(0, 400));

    console.log('\n=== C. console 输出里有没有 "Checking out Revision" ===');
    const con = await getConsoleHead(`${jkBase}${jobPath}/245/consoleText`);
    console.log(`  HTTP ${con.status}，读到 ${Buffer.byteLength(con.text)} 字节`);
    const lines = con.text.split(/\r?\n/);
    const hits = lines.filter((l) => /Checking out Revision|git checkout|Revision:|commit |GIT_COMMIT|Cloning the remote/i.test(l));
    if (hits.length === 0) {
        console.log('  没命中；前 12 行如下：');
        lines.slice(0, 12).forEach((l) => console.log('    ' + l.slice(0, 160)));
    } else {
        hits.slice(0, 20).forEach((l) => console.log('    ' + l.slice(0, 200)));
    }

    const sha = (con.text.match(/Checking out Revision ([0-9a-f]{40})/i) ?? [])[1];
    console.log(`\n  抽到的 commit = ${sha ?? '(无)'}`);

    console.log('\n=== D. GitLab 是否知道这个 commit 的 Jenkins 状态（commit statuses） ===');
    if (!sha) {
        console.log('  没有 sha，跳过');
    } else {
        for (const project of ['ultrasoundgeneralimaging/gipc-app', '105706']) {
            const st = await getJson(
                `${glBase}/api/v4/projects/${encodeURIComponent(String(project))}/repository/commits/${sha}/statuses`,
                { 'PRIVATE-TOKEN': gl.token }
            );
            if (Array.isArray(st.json)) {
                console.log(`  project ${project}: ${st.json.length} 条 status`);
                st.json.slice(0, 5).forEach((s) =>
                    console.log(`    ${s.status} | ${s.name} | ${s.target_url ?? ''}`.slice(0, 200))
                );
            } else {
                console.log(`  project ${project}: HTTP ${st.status} ${String(st.body ?? '').slice(0, 120)}`);
            }
        }

        console.log('\n=== E. GitLab 侧该 commit 的 pipelines（若有 CI 回写） ===');
        const pl = await getJson(
            `${glBase}/api/v4/projects/${encodeURIComponent('ultrasoundgeneralimaging/gipc-app')}/pipelines?sha=${sha}`,
            { 'PRIVATE-TOKEN': gl.token }
        );
        console.log('  ' + JSON.stringify(pl.json ?? pl.body ?? pl.status).slice(0, 400));
    }
})();
