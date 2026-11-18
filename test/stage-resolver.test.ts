import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { BuildFact, MrFact } from '../src/models/Board';
import { containmentKey } from '../src/services/BuildAncestry';
import { buildChecksApplyTo, inheritsParentStage, isBugLikeType, pickCardMr, resolveStage } from '../src/services/DeliveryStageResolver';

function mr(overrides: Partial<MrFact> & { iid: number }): MrFact {
    return {
        title: `MR ${overrides.iid}`,
        state: 'opened',
        url: `https://gitlab/!${overrides.iid}`,
        targetBranch: 'nexus/dev/7.10.x',
        sourceBranch: `bug-${overrides.iid}`,
        approved: false,
        approvedBy: [],
        approvalsLeft: 1,
        approvalsKnown: true,
        matchedBy: 'title',
        isCardMr: false,
        ...overrides,
    };
}

function build(number: number, timestamp: string, result: string | null): BuildFact {
    return { number, result, timestamp: Date.parse(timestamp), branch: 'nexus/dev/7.10.x', url: 'u' };
}

function buildWithSha(number: number, timestamp: string, result: string | null, sha: string): BuildFact {
    return { ...build(number, timestamp, result), sha };
}

const MERGED_AT = '2026-11-06T08:48:00Z';

test('untracked project gets no stage at all', () => {
    const result = resolveStage({ tracked: false, dataOk: true, buildChannel: 'none', mrs: [], builds: [] });
    assert.equal(result.stage, null);
});

test('a data-source failure is unknown, never "not submitted"', () => {
    const result = resolveStage({ tracked: true, dataOk: false, buildChannel: 'full', mrs: [], builds: [] });
    assert.equal(result.stage, 'unknown');
});

test('no associated MR means not submitted', () => {
    const result = resolveStage({ tracked: true, dataOk: true, buildChannel: 'full', mrs: [], builds: [] });
    assert.equal(result.stage, 'none');
});

test('an open MR with an approver but approved=false stays MR awaiting review', () => {
    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [mr({ iid: 3636, approved: false, approvedBy: ['Somebody'], approvalsLeft: 1 })],
        builds: [],
    });
    assert.equal(result.stage, 'mr');
    assert.match(result.evidence.join('\n'), /未批准/);
});

test('an approved open MR is approved-not-merged', () => {
    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [mr({ iid: 3742, approved: true, approvedBy: ['Reviewer'], approvalsLeft: 0 })],
        builds: [],
    });
    assert.equal(result.stage, 'approved');
});

test('a failed /approvals call is unknown, not "awaiting review"', () => {
    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [mr({ iid: 3742, approvalsKnown: false, approvalsLeft: null })],
        builds: [],
    });
    assert.equal(result.stage, 'unknown');
    assert.match(result.evidence.join('\n'), /取数失败/);
});

test('a merge with no later build sits at merged', () => {
    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [mr({ iid: 3769, state: 'merged', mergedAt: MERGED_AT })],
        builds: [build(243, '2026-11-05T14:00:00Z', 'SUCCESS')],
    });
    assert.equal(result.stage, 'merged');
    assert.equal(result.buildFailed, false);
});

test('a successful build after the merge advances to built', () => {
    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [mr({ iid: 3769, state: 'merged', mergedAt: MERGED_AT })],
        builds: [build(245, '2026-11-06T14:00:00Z', 'SUCCESS')],
    });
    assert.equal(result.stage, 'built');
    assert.equal(result.build?.number, 245);
});

test('a running build is neither success nor failure', () => {
    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [mr({ iid: 3769, state: 'merged', mergedAt: MERGED_AT })],
        builds: [build(246, '2026-11-07T04:07:00Z', null)],
    });
    assert.equal(result.stage, 'merged');
    assert.equal(result.buildFailed, false);
});

test('a failed build without any ancestry proof stays merged and is not flagged', () => {
    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [mr({ iid: 3769, state: 'merged', mergedAt: MERGED_AT })],
        builds: [build(246, '2026-11-07T04:07:00Z', 'FAILURE')],
    });
    assert.equal(result.stage, 'merged');
    assert.equal(result.buildFailed, false);
});

test('a later success clears an earlier failure', () => {
    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [mr({ iid: 3769, state: 'merged', mergedAt: MERGED_AT })],
        builds: [build(246, '2026-11-06T15:00:00Z', 'FAILURE'), build(247, '2026-11-07T04:07:00Z', 'SUCCESS')],
    });
    assert.equal(result.stage, 'built');
    assert.equal(result.buildFailed, false);
});

test('a repo without a build channel tops out at merged', () => {
    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'merge-only',
        mrs: [mr({ iid: 3769, state: 'merged', mergedAt: MERGED_AT })],
        builds: [build(245, '2026-11-06T14:00:00Z', 'SUCCESS')],
    });
    assert.equal(result.stage, 'merged');
    assert.equal(result.build, undefined);
    assert.match(result.evidence.join('\n'), /顶格在「已合入」/);
});

test('with several MRs the newest one is the current round', () => {
    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [mr({ iid: 3720, state: 'merged', mergedAt: '2026-11-03T10:19:00Z' }), mr({ iid: 3773, approved: true })],
        builds: [],
    });
    // 旧 MR 已合入、新 MR 仍在审：卡片要显示当前这一轮（已审批），不是历史最高的「已合入」
    assert.equal(result.stage, 'approved');
    assert.equal(result.cardMr?.iid, 3773);
    assert.match(result.evidence.join('\n'), /另有 1 个更早的 MR/);
});

test('a closed unmerged MR never outranks an active one', () => {
    const mrs = [mr({ iid: 3720, state: 'merged', mergedAt: '2026-11-03T10:19:00Z' }), mr({ iid: 3800, state: 'closed' })];
    assert.equal(pickCardMr(mrs)?.iid, 3720);
});

test('at the same stage the most recent merge is shown', () => {
    const mrs = [
        mr({ iid: 3720, state: 'merged', mergedAt: '2026-11-03T10:19:00Z' }),
        mr({ iid: 3769, state: 'merged', mergedAt: '2026-11-06T08:48:00Z' }),
    ];
    assert.equal(pickCardMr(mrs)?.iid, 3769);
    assert.equal(resolveStage({ tracked: true, dataOk: true, buildChannel: 'full', mrs, builds: [] }).cardMr?.iid, 3769);
});

test('a subtask with no MR inherits the parent stage', () => {
    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [],
        builds: [],
        inherited: { stage: 'built', buildFailed: false, evidence: ['父任务 NEX2-932 已构建'], mr: mr({ iid: 3769, state: 'merged' }) },
    });
    assert.equal(result.stage, 'built');
    assert.equal(result.cardMr?.iid, 3769);
    assert.match(result.evidence[0], /继承父任务/);
});

// --- 构建校验按 issue 类型分化：Story / Bug 看构建，Task / Sub-task 不看 ---

test('Story, Bug and In-Sprint Bug are build-checked by default', () => {
    assert.equal(buildChecksApplyTo('Story'), true);
    assert.equal(buildChecksApplyTo('bug'), true);
    assert.equal(buildChecksApplyTo('In-Sprint Bug'), true);
    assert.equal(buildChecksApplyTo('Task'), false);
    assert.equal(buildChecksApplyTo('Sub-task'), false);
    // 其余变体仍需要显式加入 pcBoard.buildCheckIssueTypes
    assert.equal(buildChecksApplyTo('Technical Task'), false);
});

test('a bug child never inherits the parent stage', () => {
    assert.equal(isBugLikeType('In-Sprint Bug'), true);
    assert.equal(isBugLikeType('Story'), false);
    // 配置/文档类子任务（codeWork=false）照旧继承；
    // In-Sprint Bug 这类代码工作（codeWork=true）必须按自己的 MR 算
    assert.equal(inheritsParentStage(true, false), true);
    assert.equal(inheritsParentStage(true, true), false);
    assert.equal(inheritsParentStage(false, true), false);
});

test('a Task tops out at merged even when a later successful build exists', () => {
    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        buildChecked: false,
        issueType: 'Task',
        mrs: [mr({ iid: 3769, state: 'merged', mergedAt: MERGED_AT })],
        builds: [build(245, '2026-11-06T14:00:00Z', 'SUCCESS')],
    });
    assert.equal(result.stage, 'merged');
    assert.equal(result.build, undefined);
    assert.equal(result.buildFailed, false);
    assert.equal(result.buildChannel, 'merge-only');
    assert.match(result.evidence.join('\n'), /不做构建校验/);
});

test('a Sub-task also tops out at merged', () => {
    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        buildChecked: false,
        issueType: 'Sub-task',
        mrs: [mr({ iid: 1054, state: 'merged', mergedAt: MERGED_AT })],
        builds: [build(245, '2026-11-06T14:00:00Z', 'SUCCESS')],
    });
    assert.equal(result.stage, 'merged');
    assert.equal(result.buildChannel, 'merge-only');
});

test('a Story with Jenkins down is unknown, not merged', () => {
    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildsOk: false,
        buildChecked: true,
        issueType: 'Story',
        buildChannel: 'full',
        mrs: [mr({ iid: 3769, state: 'merged', mergedAt: MERGED_AT })],
        builds: [],
    });
    assert.equal(result.stage, 'unknown');
    assert.match(result.evidence.join('\n'), /Jenkins 取数失败/);
});

test('a Task is unaffected by Jenkins being down', () => {
    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildsOk: false,
        buildChecked: false,
        issueType: 'Task',
        buildChannel: 'full',
        mrs: [mr({ iid: 3769, state: 'merged', mergedAt: MERGED_AT })],
        builds: [],
    });
    assert.equal(result.stage, 'merged');
});

test('Jenkins being down does not affect an unmerged card', () => {
    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildsOk: false,
        buildChecked: true,
        issueType: 'Bug',
        buildChannel: 'full',
        mrs: [mr({ iid: 3773, approved: true, approvalsLeft: 0 })],
        builds: [],
    });
    assert.equal(result.stage, 'approved');
});

test('a successful build whose tree contains the merge commit makes the card built', () => {
    const merged = mr({ iid: 3769, state: 'merged', mergedAt: MERGED_AT, mergeCommitSha: 'aaaa1111' });
    const success = buildWithSha(245, '2026-11-06T14:00:00Z', 'SUCCESS', 'bbbb2222');

    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [merged],
        builds: [success],
        containment: new Map([[containmentKey(merged, success), true]]),
    });

    assert.equal(result.stage, 'built');
    assert.equal(result.build?.number, 245);
    assert.match(
        result.evidence.join('\n'),
        /最新成功构建 #245，开始于 \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}（UTC\+8），包含本次合入/
    );
});

test('the build evidence carries the UTC+8 start and end of the build', () => {
    const merged = mr({ iid: 3769, state: 'merged', mergedAt: MERGED_AT, mergeCommitSha: 'aaaa1111' });
    // 2026-11-06T14:00Z = UTC+8 的 22:00，跑 4 小时 → 次日 02:00
    const success = {
        ...buildWithSha(245, '2026-11-06T14:00:00Z', 'SUCCESS', 'bbbb2222'),
        durationMs: 4 * 3600 * 1000,
    };

    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [merged],
        builds: [success],
        containment: new Map([[containmentKey(merged, success), true]]),
    });

    assert.equal(result.stage, 'built');
    assert.match(
        result.evidence.join('\n'),
        /开始于 2026-11-06 22:00:00，结束于 2026-11-07 02:00:00（UTC\+8）/
    );
    // 合入时间也不再贴 GitLab 的原始 ISO 串
    assert.match(result.evidence.join('\n'), /合入时间 2026-11-06 16:48:00（UTC\+8）/);
});

test('a build that does not contain the merge commit leaves the card at merged', () => {
    const merged = mr({ iid: 3769, state: 'merged', mergedAt: MERGED_AT, mergeCommitSha: 'aaaa1111' });
    const success = buildWithSha(245, '2026-11-06T14:00:00Z', 'SUCCESS', 'cccc3333');

    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [merged],
        builds: [success],
        containment: new Map([[containmentKey(merged, success), false]]),
    });

    assert.equal(result.stage, 'merged');
    assert.match(result.evidence.join('\n'), /不含本次合入/);
});

test('the same SHA built twice shows the newer build', () => {
    const merged = mr({ iid: 3769, state: 'merged', mergedAt: MERGED_AT, mergeCommitSha: 'aaaa1111' });
    const older = buildWithSha(245, '2026-11-06T14:00:00Z', 'SUCCESS', 'dddd4444');
    const newer = buildWithSha(246, '2026-11-07T04:07:00Z', 'SUCCESS', 'dddd4444');

    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [merged],
        builds: [older, newer],
        containment: new Map([
            [containmentKey(merged, older), true],
            [containmentKey(merged, newer), true],
        ]),
    });

    assert.equal(result.stage, 'built');
    assert.equal(result.build?.number, 246);
});

test('a FAILURE build is never counted as built, but an earlier successful containment still is', () => {
    const merged = mr({ iid: 3769, state: 'merged', mergedAt: MERGED_AT, mergeCommitSha: 'aaaa1111' });
    const success = buildWithSha(245, '2026-11-06T14:00:00Z', 'SUCCESS', 'eeee5555');
    const failure = buildWithSha(246, '2026-11-07T04:07:00Z', 'FAILURE', 'ffff6666');

    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [merged],
        builds: [success, failure],
        containment: new Map([
            [containmentKey(merged, success), true],
            [containmentKey(merged, failure), true],
        ]),
    });

    assert.equal(result.stage, 'built');
    assert.equal(result.build?.number, 245);
});

test('without a SHA the time window decides and the evidence says it is inferred', () => {
    const merged = mr({ iid: 3769, state: 'merged', mergedAt: MERGED_AT, mergeCommitSha: 'aaaa1111' });
    const success = build(245, '2026-11-06T14:00:00Z', 'SUCCESS');

    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [merged],
        builds: [success],
        containment: new Map([[containmentKey(merged, success), null]]),
    });

    assert.equal(result.stage, 'built');
    assert.match(result.evidence.join('\n'), /推断/);
});

test('a restored snapshot says it did not ask the ancestry question this round', () => {
    const merged = mr({ iid: 3769, state: 'merged', mergedAt: MERGED_AT, mergeCommitSha: 'aaaa1111' });
    const success = buildWithSha(245, '2026-11-06T14:00:00Z', 'SUCCESS', 'bbbb2222');

    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [merged],
        builds: [success],
        // 从事实库恢复：不联网，containment 一定是空的
        containment: new Map(),
        containmentNote: 'restored',
    });

    assert.equal(result.stage, 'built');
    assert.match(result.evidence.join('\n'), /本轮是事实库恢复，没有联网问祖先关系/);
});

test('a card never built before is flagged when the failing build provably contains its merge', () => {
    const merged = mr({ iid: 3769, state: 'merged', mergedAt: MERGED_AT, mergeCommitSha: 'aaaa1111' });
    const failure = buildWithSha(246, '2026-11-07T04:07:00Z', 'FAILURE', 'ffff6666');

    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [merged],
        builds: [failure],
        containment: new Map([[containmentKey(merged, failure), true]]),
        newlyIntroduced: 2,
    });

    assert.equal(result.stage, 'merged');
    assert.equal(result.buildFailed, true);
    assert.equal(result.build?.number, 246);
    const evidence = result.evidence.join('\n');
    assert.match(evidence, /新引入的合入共 2 个/);
    assert.match(evidence, /不断定是它引起的/);
});

test('a card already contained in an earlier success is never flagged red', () => {
    const merged = mr({ iid: 3769, state: 'merged', mergedAt: MERGED_AT, mergeCommitSha: 'aaaa1111' });
    const success = buildWithSha(245, '2026-11-06T14:00:00Z', 'SUCCESS', 'eeee5555');
    const failure = buildWithSha(246, '2026-11-07T04:07:00Z', 'FAILURE', 'ffff6666');

    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [merged],
        builds: [success, failure],
        containment: new Map([
            [containmentKey(merged, success), true],
            [containmentKey(merged, failure), true],
        ]),
    });

    assert.equal(result.stage, 'built');
    assert.equal(result.buildFailed, false);
});

test('a card whose merge is not in the failing build is not flagged', () => {
    const merged = mr({ iid: 3769, state: 'merged', mergedAt: MERGED_AT, mergeCommitSha: 'aaaa1111' });
    const failure = buildWithSha(246, '2026-11-07T04:07:00Z', 'FAILURE', 'ffff6666');

    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [merged],
        builds: [failure],
        containment: new Map([[containmentKey(merged, failure), false]]),
    });

    assert.equal(result.buildFailed, false);
});

test('a success whose ancestry is unknown keeps the failing build off the card', () => {
    const merged = mr({ iid: 3769, state: 'merged', mergedAt: MERGED_AT, mergeCommitSha: 'aaaa1111' });
    const success = build(245, '2026-11-06T14:00:00Z', 'SUCCESS');
    const failure = buildWithSha(246, '2026-11-07T04:07:00Z', 'FAILURE', 'ffff6666');

    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [merged],
        builds: [success, failure],
        containment: new Map([[containmentKey(merged, failure), true]]),
    });

    // 成功构建到底包含不包含它，判不出来 → 不能标红
    assert.equal(result.buildFailed, false);
});

test('an unknown ancestor relation never turns the board red', () => {
    const merged = mr({ iid: 3769, state: 'merged', mergedAt: MERGED_AT, mergeCommitSha: 'aaaa1111' });
    const failure = build(246, '2026-11-07T04:07:00Z', 'FAILURE');

    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [merged],
        builds: [failure],
        containment: new Map([[containmentKey(merged, failure), null]]),
    });

    assert.equal(result.buildFailed, false);
});

// --- 测试未通过退回开发：本轮从「未提交」重新起算 ---

const REWORK_INPUT = { statusName: 'In Progress', reworkStatuses: ['In Progress'] };

function builtOnce() {
    const delivered = mr({ iid: 3769, state: 'merged', mergedAt: MERGED_AT, mergeCommitSha: 'aaaa1111' });
    const success = buildWithSha(245, '2026-11-06T14:00:00Z', 'SUCCESS', 'bbbb2222');
    return { delivered, success, containment: new Map([[containmentKey(delivered, success), true]]) };
}

test('back in development, a built card stops claiming 已构建 until a new MR appears', () => {
    const { delivered, success, containment } = builtOnce();
    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [delivered],
        builds: [success],
        containment,
        ...REWORK_INPUT,
    });

    assert.equal(result.stage, 'none');
    assert.equal(result.rework, true);
    assert.match(result.evidence.join('\n'), /已退回开发：本轮从「未提交」重新起算/);
    assert.match(result.evidence.join('\n'), /本轮还没有新的 MR/);
});

test('once the rework MR is opened the round follows it, not the old built MR', () => {
    const { delivered, success, containment } = builtOnce();
    const reworkMr = mr({ iid: 3800, approved: false });

    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [delivered, reworkMr],
        builds: [success],
        containment,
        ...REWORK_INPUT,
    });

    assert.equal(result.stage, 'mr');
    assert.equal(result.cardMr?.iid, 3800);
    assert.equal(result.rework, true);
});

test('a rework MR merged but not built shows 已合入待构建', () => {
    const { delivered, success, containment } = builtOnce();
    const reworkMr = mr({ iid: 3800, state: 'merged', mergedAt: '2026-11-10T08:00:00Z' });

    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [delivered, reworkMr],
        builds: [success],
        containment,
        ...REWORK_INPUT,
    });

    assert.equal(result.stage, 'merged');
    assert.equal(result.rework, true);
});

test('a status outside the rework list keeps the delivered stage', () => {
    const { delivered, success, containment } = builtOnce();
    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [delivered],
        builds: [success],
        containment,
        statusName: 'In Test',
        reworkStatuses: ['In Progress'],
    });

    assert.equal(result.stage, 'built');
    assert.notEqual(result.rework, true);
});

test('a card never delivered is not marked as rework', () => {
    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [mr({ iid: 3800 })],
        builds: [],
        ...REWORK_INPUT,
    });

    assert.equal(result.stage, 'mr');
    assert.notEqual(result.rework, true);
});


