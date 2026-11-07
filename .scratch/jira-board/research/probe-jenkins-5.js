/**
 * 只读探针：确认构建参数里是否可能带 commit id，以及构建节奏。
 * job: UltrasoundGeneralImaging / ultrasoundgeneralimaging%2Fgipc-app / nexus%2Fdev%2F7.10.x
 * 跑法：node .scratch/jira-board/research/probe-jenkins-5.js
 */
const https = require('https');
const { loadScrumBuddyConfig } = require('../../../out/services/ScrumBuddyConfig.js');

const cfg = loadScrumBuddyConfig();
const jk = cfg.jenkins;
const base = String(jk.baseUrl).replace(/\/+$/, '');
const auth = 'Basic ' + Buffer.from(`${jk.username}:${jk.token}`).toString('base64');
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

function get(path, timeoutMs = 25000) {
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
                if (res.statusCode >= 400) { resolve(null); return; }
                try { resolve(JSON.parse(text)); } catch { resolve(null); }
            });
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', () => resolve(null));
        req.end();
    });
}

const seg = encodeURIComponent;
const jobPath = `/job/${seg('UltrasoundGeneralImaging')}/job/${seg('ultrasoundgeneralimaging%2Fgipc-app')}/job/${seg('nexus%2Fdev%2F7.10.x')}`;

(async () => {
    console.log('=== A. 最近 8 次构建的 GITLAB_COMMIT_ID / 结果 / 时间 ===');
    for (const n of [246, 245, 244, 243, 242, 241, 240, 239]) {
        const b = await get(`${jobPath}/${n}/api/json?tree=number,result,timestamp,building,duration,actions[parameters[name,value]]`);
        if (!b) { console.log(`  #${n}: 取不到`); continue; }
        const params = (b.actions ?? []).flatMap((a) => a.parameters ?? []);
        const commit = params.find((p) => p.name === 'GITLAB_COMMIT_ID')?.value ?? '(无该参数)';
        const branch = params.find((p) => p.name === 'GITLAB_BRANCH')?.value ?? '-';
        console.log(`  #${b.number} ${String(b.result).padEnd(8)} ${b.timestamp ? new Date(b.timestamp).toISOString().slice(0, 16) : '-'}  耗时 ${Math.round((b.duration || 0) / 60000)}min  branch=${branch}  commit_id=${commit === '' ? '(空)' : commit}`);
    }

    console.log('\n=== B. #243 的全部参数名 ===');
    const b = await get(`${jobPath}/243/api/json?tree=actions[parameters[name,value]]`);
    const params = (b?.actions ?? []).flatMap((a) => a.parameters ?? []);
    console.log('  参数数 = ' + params.length);
    for (const p of params) console.log(`    ${p.name} = ${String(p.value).slice(0, 70)}`);

    console.log('\n=== C. main 分支 job 是否存在、最近结果 ===');
    const mainJob = `/job/${seg('UltrasoundGeneralImaging')}/job/${seg('ultrasoundgeneralimaging%2Fgipc-app')}/job/${seg('main')}`;
    const ml = await get(`${mainJob}/lastBuild/api/json?tree=number,result,timestamp`);
    console.log(`  main: ` + (ml ? `#${ml.number} ${ml.result} ${new Date(ml.timestamp).toISOString().slice(0, 16)}` : '无构建/无此 job'));
})();
