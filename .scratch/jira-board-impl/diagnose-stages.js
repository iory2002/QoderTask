/**
 * 诊断：用 out/ 里编译后的真实服务，复算当前 NEX2 卡片的交付阶段。
 * 目的：判断「只看到未提交和已构建」是数据如此，还是判定有漏洞。
 *
 * 跑法：node .scratch/jira-board-impl/diagnose-stages.js
 */
const { loadScrumBuddyConfig } = require('../../out/services/ScrumBuddyConfig.js');
const { GitLabService } = require('../../out/services/GitLabService.js');
const { JenkinsService } = require('../../out/services/JenkinsService.js');
const { associateMrs, toMrFacts } = require('../../out/services/MrAssociation.js');
const { resolveStage, buildChecksApplyTo } = require('../../out/services/DeliveryStageResolver.js');

const cfg = loadScrumBuddyConfig();
const jira = cfg.jira;
const PROJECT = 'NEX2';
const GITLAB_PROJECT = 'ultrasoundgeneralimaging/gipc-app';
const BRANCH = 'nexus/dev/7.10.x';
const JOB = 'UltrasoundGeneralImaging/ultrasoundgeneralimaging%2Fgipc-app/nexus%2Fdev%2F7.10.x';

const base = String(jira.baseUrl).replace(/\/+$/, '');
const auth = 'Basic ' + Buffer.from(`${jira.username}:${jira.password}`).toString('base64');

async function jget(path) {
    const res = await fetch(base + path, { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    if (res.status >= 400) throw new Error(`HTTP ${res.status} ${path}`);
    return JSON.parse(text);
}

const enc = encodeURIComponent;

(async () => {
    // 1) 活跃 sprint
    const sprints = await jget('/rest/agile/1.0/board/23/sprint?state=active');
    const sprint = sprints.values?.[0];
    if (!sprint) throw new Error('没有活跃 sprint');
    console.log(`sprint = ${sprint.id} "${sprint.name}"`);

    // 2) 卡片（含只看我的 / 全部 两种）
    const fields = 'summary,status,issuetype,parent';
    const jqlAll = `sprint = ${sprint.id} AND project = ${PROJECT} AND issuetype != Epic`;
    const jqlMine = `${jqlAll} AND assignee = currentUser()`;
    const all = await jget(`/rest/api/2/search?jql=${enc(jqlAll)}&fields=${fields}&maxResults=500`);
    const mine = await jget(`/rest/api/2/search?jql=${enc(jqlMine)}&fields=${fields}&maxResults=500`);
    console.log(`卡片数：全部 ${all.total} / 只看我的 ${mine.total}\n`);

    // 3) GitLab / Jenkins 事实
    const gitlab = new GitLabService();
    const jenkins = new JenkinsService();
    console.log(`GitLab configured=${gitlab.isConfigured()}  Jenkins configured=${jenkins.isConfigured()}`);

    const mrs = await gitlab.listTargetBranchMrs(GITLAB_PROJECT, BRANCH);
    console.log(`目标分支 MR 数 = ${mrs.length}（merged ${mrs.filter((m) => m.state === 'merged').length} / opened ${mrs.filter((m) => m.state === 'opened').length} / closed ${mrs.filter((m) => m.state === 'closed').length}）`);

    const byKey = associateMrs(mrs, [PROJECT]);
    console.log(`能关联到 key 的 MR 组 = ${byKey.size}`);

    // opened 的补审批（与 BoardState 一致）
    const approvals = new Map();
    const opened = mrs.filter((m) => m.state === 'opened');
    for (const mr of opened) {
        approvals.set(mr.iid, await gitlab.getApprovals(GITLAB_PROJECT, mr.iid));
    }

    const facts = new Map();
    for (const [key, associated] of byKey) {
        facts.set(key, toMrFacts(associated).map((fact) => {
            if (fact.state !== 'opened') return fact;
            const approval = approvals.get(fact.iid);
            return approval === undefined
                ? { ...fact, approvalsKnown: false }
                : { ...fact, approved: approval.approved, approvedBy: approval.approvedBy, approvalsLeft: approval.approvalsLeft, approvalsKnown: true };
        }));
    }

    const builds = await jenkins.getRecentBuilds(JOB, BRANCH);
    console.log(`构建数 = ${builds.length}（最近：#${builds[0]?.number} ${builds[0]?.result} ${builds[0] ? new Date(builds[0].timestamp).toISOString().slice(0, 16) : ''}）\n`);

    // 4) 逐卡复算
    function report(label, issues) {
        console.log(`===== ${label} =====`);
        const counts = {};
        for (const issue of issues) {
            const key = issue.key;
            const type = issue.fields.issuetype?.name ?? '?';
            const myMrs = facts.get(key) ?? [];
            const result = resolveStage({
                tracked: true,
                dataOk: true,
                buildsOk: true,
                buildChecked: buildChecksApplyTo(type, ['Story', 'Bug']),
                issueType: type,
                buildChannel: 'full',
                mrs: myMrs,
                builds,
            });
            counts[String(result.stage)] = (counts[String(result.stage)] || 0) + 1;
            const mrText = myMrs.length
                ? myMrs.map((m) => `!${m.iid}(${m.state}${m.state === 'opened' ? `,approved=${m.approved},known=${m.approvalsKnown}` : ''})`).join(' ')
                : '无 MR';
            console.log(`  ${key.padEnd(11)} ${type.padEnd(12)} ${String(issue.fields.status?.name).padEnd(16)} → ${String(result.stage).padEnd(9)}  ${mrText}`);
            if (result.stage === 'merged' || result.stage === 'built') {
                console.log(`      ${result.evidence[result.evidence.length - 1]}`);
            }
        }
        console.log(`  分布：${JSON.stringify(counts)}\n`);
    }

    report('只看我的', mine.issues);
    report('整个 NEX2（关掉只看我的）', all.issues);

    // 5) 全局 MR 关联覆盖率
    console.log('===== 目标分支上所有 MR 的 key 命中情况 =====');
    let matched = 0;
    for (const mr of mrs) {
        const keys = [...byKey.entries()].filter(([, list]) => list.some((a) => a.mr.iid === mr.iid)).map(([k]) => k);
        if (keys.length) matched++;
        if (mr.state === 'opened') {
            console.log(`  !${mr.iid} ${mr.state} keys=${keys.join(',') || '(无)'}  title="${String(mr.title).slice(0, 50)}"`);
        }
    }
    console.log(`  有 key 归属的 MR = ${matched} / ${mrs.length}`);
})();
