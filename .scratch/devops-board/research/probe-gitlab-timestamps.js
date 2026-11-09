/**
 * 只读探针（04）：GitLab 侧时间戳能不能拿到、取数窗口够不够。
 * 跑法：node .scratch/devops-board/research/probe-gitlab-timestamps.js
 *
 * 关心的四件事：
 *   1) MR 自身的时间戳（created/updated/merged/closed）与首个 commit 时间
 *   2) approve 的时间：/approvals 有没有时间？没有的话 /notes 的 system note 能不能补
 *   3) 90 天窗口 + 3 页够不够（用 X-Total-Pages 看）
 *   4) 限流头（多开回填时要不要退避）
 */
const https = require('https');
const { loadScrumBuddyConfig } = require('../../../out/services/ScrumBuddyConfig.js');

const cfg = loadScrumBuddyConfig();
const gl = cfg.gitlab;
const base = new URL(gl.baseUrl);
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
const P = 'ultrasoundgeneralimaging/gipc-app';
const enc = encodeURIComponent;

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
                timeout: 30000,
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf-8');
                    let json = null;
                    try {
                        json = JSON.parse(text);
                    } catch {}
                    resolve({ status: res.statusCode, headers: res.headers, json, text });
                });
            }
        );
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', (e) => resolve({ status: 0, headers: {}, text: e.message }));
        req.end();
    });
}

const iso = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : '-');

(async () => {
    // 1) 窗口覆盖：90 天内按 updated_at 能翻多少页
    const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    const q = (state, extra) =>
        `/api/v4/projects/${enc(P)}/merge_requests?state=${state}&target_branch=${enc('nexus/dev/7.10.x')}` +
        `&updated_after=${enc(since)}&per_page=100&order_by=updated_at&sort=desc${extra ?? ''}`;

    for (const state of ['all', 'merged']) {
        const r = await get(q(state));
        if (!Array.isArray(r.json)) {
            console.log(`${state}: HTTP ${r.status} ${String(r.text).slice(0, 120)}`);
            continue;
        }
        console.log(
            `窗口[${state}] 90 天内 total=${r.headers['x-total'] ?? '?'} pages=${r.headers['x-total-pages'] ?? '?'} 本页=${r.json.length}`
        );
    }

    const list = await get(q('all'));
    const rows = Array.isArray(list.json) ? list.json : [];
    const rl = list.headers;
    console.log(
        `限流头: ratelimit-remaining=${rl['ratelimit-remaining'] ?? '无'} ratelimit-limit=${rl['ratelimit-limit'] ?? '无'} ` +
            `retry-after=${rl['retry-after'] ?? '无'}`
    );

    // 2) 时间戳字段
    const merged = rows.filter((r) => r.state === 'merged').slice(0, 2);
    const open = rows.filter((r) => r.state === 'opened').slice(0, 2);
    console.log('\n=== MR 自身时间戳 ===');
    for (const mr of [...merged, ...open]) {
        console.log(
            `!${mr.iid} [${mr.state}] created=${iso(mr.created_at)} updated=${iso(mr.updated_at)} ` +
                `merged=${iso(mr.merged_at)} closed=${iso(mr.closed_at)} sha=${String(mr.merge_commit_sha).slice(0, 8)}`
        );
    }

    // 3) 首个 commit 时间（前置时间的起点候选）
    const first = [...merged, ...open][0];
    if (first) {
        const commits = await get(`/api/v4/projects/${enc(P)}/merge_requests/${first.iid}/commits?per_page=100`);
        if (Array.isArray(commits.json) && commits.json.length > 0) {
            const dates = commits.json.map((c) => c.authored_date || c.created_at).filter(Boolean).sort();
            console.log(`!${first.iid} commits=${commits.json.length} 最早=${iso(dates[0])} 最晚=${iso(dates[dates.length - 1])}`);
        } else {
            console.log(`!${first.iid} commits: HTTP ${commits.status}`);
        }
    }

    // 4) approvals 里有没有时间戳
    console.log('\n=== /approvals 是否带时间 ===');
    for (const mr of [...open, ...merged]) {
        const a = await get(`/api/v4/projects/${enc(P)}/merge_requests/${mr.iid}/approvals`);
        if (a.json && Array.isArray(a.json.approved_by)) {
            const sample = a.json.approved_by[0];
            console.log(
                `!${mr.iid} [${mr.state}] approved_by=${a.json.approved_by.length} ` +
                    `sample keys=${sample ? Object.keys(sample).join(',') : '(空)'}`
            );
        } else {
            console.log(`!${mr.iid} [${mr.state}] HTTP ${a.status} ${String(a.text).slice(0, 80)}`);
        }
    }

    // 5) notes 里的 system note 能不能补 approve 时间
    console.log('\n=== /notes 的审批类 system note ===');
    for (const mr of [...open, ...merged]) {
        const notes = await get(`/api/v4/projects/${enc(P)}/merge_requests/${mr.iid}/notes?per_page=100&sort=asc`);
        if (!Array.isArray(notes.json)) {
            console.log(`!${mr.iid} notes HTTP ${notes.status}`);
            continue;
        }
        const sys = notes.json.filter(
            (n) => n.system && /approved|unapproved|requested changes|removed|changes/i.test(n.body ?? '')
        );
        console.log(`!${mr.iid} [${mr.state}] notes=${notes.json.length} 审批相关=${sys.length}`);
        for (const n of sys.slice(0, 4)) {
            console.log(`    ${iso(n.created_at)}  ${String(n.body).replace(/\s+/g, ' ').slice(0, 70)}`);
        }
    }

    // 6) resource_state_events（更结构化的状态变更）
    console.log('\n=== resource_state_events ===');
    for (const mr of [...open, ...merged].slice(0, 2)) {
        const e = await get(`/api/v4/projects/${enc(P)}/merge_requests/${mr.iid}/resource_state_events`);
        if (Array.isArray(e.json)) {
            console.log(`!${mr.iid} events=${e.json.length}` + (e.json[0] ? ` 首条 keys=${Object.keys(e.json[0]).join(',')}` : ''));
        } else {
            console.log(`!${mr.iid} HTTP ${e.status} ${String(e.text).slice(0, 80)}`);
        }
    }
})();
