import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { GitLabApprovals } from '../src/services/GitLabService';
import { classify, mrKey, type MrCandidate } from '../src/services/MrBoardResolver';

const VIEWER = 42;
const PROJECT = 'ultrasoundgeneralimaging/gipc-app';

function candidate(overrides: Partial<MrCandidate> & { iid: number }): MrCandidate {
    return {
        projectPath: PROJECT,
        title: `MR ${overrides.iid}`,
        description: '',
        url: `https://gitlab/!${overrides.iid}`,
        state: 'opened',
        sourceBranch: `bug-${overrides.iid}`,
        targetBranch: 'nexus/dev/7.10.x',
        author: { id: 7, name: 'Alice', username: 'alice' },
        reviewerIds: [VIEWER],
        draft: false,
        createdAt: '2026-11-01T00:00:00Z',
        updatedAt: '2026-11-05T00:00:00Z',
        hasConflicts: null,
        blockingDiscussionsResolved: null,
        ...overrides,
    };
}

function approval(approvedByIds: number[], approvalsLeft = 1): GitLabApprovals {
    return {
        approved: approvalsLeft === 0,
        approvalsLeft,
        approvedBy: approvedByIds.map((id) => `user-${id}`),
        approvedByIds,
        approvedByPeople: approvedByIds.map((id) => ({ id, name: `user-${id}`, username: `u${id}` })),
    };
}

function run(input: {
    candidates: MrCandidate[];
    approvals?: Map<string, GitLabApprovals | undefined>;
    reviewerQueryKeys?: string[];
}) {
    return classify({
        candidates: input.candidates,
        viewerId: VIEWER,
        approvals: input.approvals ?? new Map(),
        jiraProjects: ['NEX2'],
        reviewerQueryKeys: input.reviewerQueryKeys,
    });
}

test('merged MRs are dropped and never counted as closed', () => {
    const result = run({ candidates: [candidate({ iid: 1, state: 'merged' })] });
    assert.equal(result.reviewQueue.length, 0);
    assert.equal(result.myMrs.length, 0);
    assert.equal(result.closedCount, 0);
});

test('closed MRs are counted but never placed in a column', () => {
    const result = run({
        candidates: [candidate({ iid: 1, state: 'closed' }), candidate({ iid: 2, state: 'closed' })],
    });
    assert.equal(result.closedCount, 2);
    assert.equal(result.reviewQueue.length, 0);
    assert.equal(result.myMrs.length, 0);
});

test('a draft is invisible and does not affect any count', () => {
    const result = run({ candidates: [candidate({ iid: 1, draft: true }), candidate({ iid: 2, state: 'closed', draft: true })] });
    assert.equal(result.reviewQueue.length, 0);
    assert.equal(result.myMrs.length, 0);
    assert.equal(result.closedCount, 0);
});

test('reviewer who has not approved lands in the review queue', () => {
    const mr = candidate({ iid: 10 });
    const result = run({
        candidates: [mr],
        approvals: new Map([[mrKey(PROJECT, 10), approval([99], 1)]]),
    });
    assert.equal(result.reviewQueue.length, 1);
    assert.equal(result.reviewQueue[0].reviewState, 'awaiting-me');
});

test('a reviewer who already approved leaves the queue entirely', () => {
    const mr = candidate({ iid: 11, author: { id: 7, name: 'Alice', username: 'alice' } });
    const result = run({
        candidates: [mr],
        approvals: new Map([[mrKey(PROJECT, 11), approval([VIEWER, 99], 0)]]),
    });
    assert.equal(result.reviewQueue.length, 0);
    assert.equal(result.myMrs.length, 0);
});

test('a failed approvals call keeps the MR in the queue as unknown', () => {
    const mr = candidate({ iid: 12 });
    const result = run({
        candidates: [mr],
        approvals: new Map([[mrKey(PROJECT, 12), undefined]]),
    });
    assert.equal(result.reviewQueue.length, 1);
    assert.equal(result.reviewQueue[0].reviewState, 'unknown');
    assert.equal(result.reviewQueue[0].approvalsKnown, false);
});

test('author = me lands in my MRs regardless of assignee', () => {
    const mine = candidate({
        iid: 20,
        author: { id: VIEWER, name: 'Me', username: 'me' },
        reviewerIds: [99],
    });
    const result = run({ candidates: [mine] });
    assert.equal(result.myMrs.length, 1);
    assert.equal(result.myMrs[0].reviewState, 'unknown');
});

test('someone else reviewing my MR marks it reviewed', () => {
    const mine = candidate({
        iid: 21,
        author: { id: VIEWER, name: 'Me', username: 'me' },
        reviewerIds: [99],
    });
    const result = run({
        candidates: [mine],
        approvals: new Map([[mrKey(PROJECT, 21), approval([7, 99], 0)]]),
    });
    assert.equal(result.myMrs.length, 1);
    assert.equal(result.myMrs[0].reviewState, 'reviewed');
    assert.equal(result.myMrs[0].approvedBy.length, 2);
});

test('my MR with no approvals is unreviewed', () => {
    const mine = candidate({
        iid: 22,
        author: { id: VIEWER, name: 'Me', username: 'me' },
        reviewerIds: [99],
    });
    const result = run({
        candidates: [mine],
        approvals: new Map([[mrKey(PROJECT, 22), approval([], 1)]]),
    });
    assert.equal(result.myMrs[0].reviewState, 'unreviewed');
});

test('an MR that is both mine and my review target appears only in the queue', () => {
    const mr = candidate({
        iid: 23,
        author: { id: VIEWER, name: 'Me', username: 'me' },
        reviewerIds: [VIEWER],
    });
    const result = run({
        candidates: [mr],
        approvals: new Map([[mrKey(PROJECT, 23), approval([], 1)]]),
    });
    assert.equal(result.reviewQueue.length, 1);
    assert.equal(result.myMrs.length, 0);
});

test('both columns sort by updated_at desc, then iid desc', () => {
    const result = run({
        candidates: [
            candidate({ iid: 1, updatedAt: '2026-11-04T00:00:00Z' }),
            candidate({ iid: 3, updatedAt: '2026-11-06T00:00:00Z' }),
            candidate({ iid: 2, updatedAt: '2026-11-06T00:00:00Z' }),
        ],
    });
    assert.deepEqual(
        result.reviewQueue.map((card) => card.iid),
        [3, 2, 1]
    );
});

test('duplicate rows for the same MR collapse to one card', () => {
    const result = run({
        candidates: [candidate({ iid: 30 }), candidate({ iid: 30, title: 'duplicate row' })],
    });
    assert.equal(result.reviewQueue.length, 1);
});

test('a title covering two issues yields both Jira keys', () => {
    const result = run({
        candidates: [candidate({ iid: 40, title: 'NEX2-1038+1039 fix the thing' })],
    });
    assert.deepEqual(result.reviewQueue[0].jiraKeys, ['NEX2-1038', 'NEX2-1039']);
});

test('an MR with no key anywhere still shows up', () => {
    const result = run({ candidates: [candidate({ iid: 41, title: 'task-bfapc', sourceBranch: 'task-bfapc' })] });
    assert.equal(result.reviewQueue.length, 1);
    assert.deepEqual(result.reviewQueue[0].jiraKeys, []);
});

test('rows returned by the reviewer query that do not list me are excluded and counted', () => {
    const notMine = candidate({ iid: 50, reviewerIds: [99], title: 'NEX2-50' });
    const result = run({
        candidates: [notMine],
        reviewerQueryKeys: [mrKey(PROJECT, 50)],
    });
    assert.equal(result.reviewQueue.length, 0);
    assert.equal(result.unseenCount, 1);
});

test('the same iid in two repositories does not collide', () => {
    const first = candidate({ iid: 60, projectPath: 'group/repo-a' });
    const second = candidate({ iid: 60, projectPath: 'group/repo-b' });
    const result = run({ candidates: [first, second] });
    assert.equal(result.reviewQueue.length, 2);
    assert.deepEqual(
        result.reviewQueue.map((card) => card.projectPath).sort(),
        ['group/repo-a', 'group/repo-b']
    );
});

test('conflicts reach the card: true stays true, false stays false', () => {
    const result = run({
        candidates: [candidate({ iid: 70, hasConflicts: true }), candidate({ iid: 71, hasConflicts: false })],
    });

    const byIid = new Map(result.reviewQueue.map((card) => [card.iid, card]));
    assert.equal(byIid.get(70)?.hasConflicts, true);
    assert.equal(byIid.get(71)?.hasConflicts, false);
});

test('a missing conflicts field is unknown, not false', () => {
    const result = run({ candidates: [candidate({ iid: 72, hasConflicts: null })] });

    assert.equal(result.reviewQueue[0].hasConflicts, null);
    assert.notEqual(result.reviewQueue[0].hasConflicts, false);
});

test('blocking discussions resolved is three-valued: true, false, unknown', () => {
    const result = run({
        candidates: [
            candidate({ iid: 80, blockingDiscussionsResolved: false }),
            candidate({ iid: 81, blockingDiscussionsResolved: true }),
            candidate({ iid: 82, blockingDiscussionsResolved: null }),
        ],
    });

    const byIid = new Map(result.reviewQueue.map((card) => [card.iid, card]));
    assert.equal(byIid.get(80)?.blockingDiscussionsResolved, false);
    assert.equal(byIid.get(81)?.blockingDiscussionsResolved, true);
    assert.equal(byIid.get(82)?.blockingDiscussionsResolved, null);
});

