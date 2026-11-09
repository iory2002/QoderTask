import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { BuildFact, MrFact } from '../src/models/Board';
import { containmentKey } from '../src/services/BuildAncestry';
import { buildChecksApplyTo, pickCardMr, resolveStage } from '../src/services/DeliveryStageResolver';

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

test('with several MRs the highest stage wins', () => {
    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [mr({ iid: 3720, state: 'merged', mergedAt: '2026-11-03T10:19:00Z' }), mr({ iid: 3773, approved: true })],
        builds: [],
    });
    assert.equal(result.stage, 'merged');
    assert.equal(result.cardMr?.iid, 3720);
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

test('only Story and Bug are build-checked by default', () => {
    assert.equal(buildChecksApplyTo('Story'), true);
    assert.equal(buildChecksApplyTo('bug'), true);
    assert.equal(buildChecksApplyTo('Task'), false);
    assert.equal(buildChecksApplyTo('Sub-task'), false);
    // 变体类型默认不包含，需要时通过 todoPanel.buildCheckIssueTypes 显式加入
    assert.equal(buildChecksApplyTo('In-Sprint Bug'), false);
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
    assert.match(result.evidence.join('\n'), /最新成功构建 #245（开始于 \d{4}-\d{2}-\d{2} \d{2}:\d{2}）包含本次合入/);
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


