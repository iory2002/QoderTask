/**
 * 只读探针：验证 MR Board 依赖的四个 GitLab 事实是否与代码假设一致。
 * 跑法：node .scratch/mr-board/probe-mr-board.js（需先 npm run compile）
 */
const { GitLabService } = require('../../out/services/GitLabService');

const project = 'ultrasoundgeneralimaging/gipc-app';
const branch = 'nexus/dev/7.10.x';

(async () => {
    const gitlab = new GitLabService();
    console.log('configured =', gitlab.isConfigured());

    const me = await gitlab.getCurrentUser();
    console.log('user =', me);

    const opened = { reviewer: [], author: [] };

    for (const role of ['reviewer', 'author']) {
        for (const state of ['opened', 'closed']) {
            const rows = await gitlab.listMrsForUser({ project, targetBranch: branch, userId: me.id, role, state });
            console.log(`${role}/${state} = ${rows.length}`);
            if (state === 'opened') {
                opened[role] = rows;
            }
            for (const row of rows.slice(0, 3)) {
                console.log(
                    `  !${row.iid} state=${row.state} draft=${row.draft} author=${row.author.username}(${row.author.id})` +
                        ` reviewers=[${row.reviewerIds.join(',')}] updated=${row.updatedAt}`
                );
            }
        }
    }

    const sample = opened.reviewer[0] ?? opened.author[0];
    if (!sample) {
        console.log('没有 opened MR，审批与 diff 未探测');
        return;
    }

    const approvals = await gitlab.getApprovals(project, sample.iid);
    console.log('approvals', approvals);

    const diff = await gitlab.getMrDiffs(project, sample.iid);
    console.log(`diff bytes = ${diff.length}, head = ${JSON.stringify(diff.slice(0, 120))}`);
})().catch((error) => {
    console.error('probe failed:', error && error.message ? error.message : error);
    if (error && error.body) {
        console.error('body:', String(error.body).slice(0, 300));
    }
    process.exit(1);
});
