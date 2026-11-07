import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { BuildFact, MrFact } from '../src/models/Board';
import { pickCardMr, resolveStage } from '../src/services/DeliveryStageResolver';

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
        matchedBy: 'title',
        isCardMr: false,
        ...overrides,
    };
}

function build(number: number, timestamp: string, result: string | null): BuildFact {
    return { number, result, timestamp: Date.parse(timestamp), branch: 'nexus/dev/7.10.x', url: 'u' };
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

test('a failed build stays at merged but raises the failure flag', () => {
    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'full',
        mrs: [mr({ iid: 3769, state: 'merged', mergedAt: MERGED_AT })],
        builds: [build(246, '2026-11-07T04:07:00Z', 'FAILURE')],
    });
    assert.equal(result.stage, 'merged');
    assert.equal(result.buildFailed, true);
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
