/**
 * 验证「钉住的 issue」JQL 与 NEX2-610 的真实阶段。
 * 跑法：node .scratch/jira-board-impl/probe-pinned.js
 */
const { loadScrumBuddyConfig } = require('../../out/services/ScrumBuddyConfig.js');
const { GitLabService } = require('../../out/services/GitLabService.js');

const cfg = loadScrumBuddyConfig();
const jira = cfg.jira;
const base = String(jira.baseUrl).replace(/\/+$/, '');
const auth = 'Basic ' + Buffer.from(`${jira.username}:${jira.password}`).toString('base64');
const enc = encodeURIComponent;
const PINNED = 'NEX2-610';

async function jget(path) {
    const res = await fetch(base + path, { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    if (res.status >= 400) throw new Error(`HTTP ${res.status} ${path} :: ${text.slice(0, 200)}`);
    return JSON.parse(text);
}

(async () => {
    const sprints = await jget('/rest/agile/1.0/board/23/sprint?state=active');
    const sprint = sprints.values?.[0];
    console.log(`sprint = ${sprint?.id} "${sprint?.name}"`);

    // 与 BoardState.buildJql 完全同形
    const scope = `(sprint = ${sprint.id} AND project IN (NEX2) AND issuetype != Epic AND assignee = currentUser())`;
    const jql = `${scope} OR key IN (${PINNED}) ORDER BY Rank ASC`;
    console.log('\nJQL = ' + jql);

    const r = await jget(`/rest/api/2/search?jql=${enc(jql)}&fields=summary,status,issuetype,assignee&maxResults=200`);
    console.log(`\n结果 ${r.total} 条，含钉住的: ${r.issues.some((i) => i.key === PINNED)}`);
    for (const i of r.issues.slice(0, 8)) {
        console.log(`  ${i.key.padEnd(11)} ${String(i.fields.issuetype?.name).padEnd(8)} ${String(i.fields.status?.name).padEnd(16)} ${String(i.fields.summary).slice(0, 40)}`);
    }

    const one = await jget(`/rest/api/2/issue/${PINNED}?fields=summary,status,issuetype,assignee,customfield_10000`);
    console.log(`\n${PINNED}: type=${one.fields.issuetype?.name} status=${one.fields.status?.name} assignee=${one.fields.assignee?.displayName ?? '未指派'}`);
    console.log(`  "${String(one.fields.summary).slice(0, 60)}"  epic=${JSON.stringify(one.fields.customfield_10000)}`);

    // MR 事实
    const gitlab = new GitLabService();
    const mrs = await gitlab.listTargetBranchMrs('ultrasoundgeneralimaging/gipc-app', 'nexus/dev/7.10.x');
    const mine = mrs.filter((m) => new RegExp(`\\b${PINNED}\\b`).test(`${m.title} ${m.sourceBranch}`));
    console.log(`\n${PINNED} 关联到的 MR = ${mine.length}`);
    for (const m of mine) {
        const ap = m.state === 'opened' ? await gitlab.getApprovals('ultrasoundgeneralimaging/gipc-app', m.iid) : undefined;
        console.log(`  !${m.iid} ${m.state} title="${String(m.title).slice(0, 45)}"`);
        if (ap) {
            console.log(`    approved=${ap.approved} approvals_left=${ap.approvalsLeft} approved_by=${ap.approvedBy.length}人`);
            console.log(`    → 预期阶段：${ap.approved ? '已 Approve 待合入' : 'MR 待审'}`);
        } else {
            console.log(`    → 预期阶段：已合入 / 已构建（视合入时间与构建）`);
        }
    }
})();
