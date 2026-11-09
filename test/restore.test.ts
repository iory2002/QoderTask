import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { BoardColumn, MrFact } from '../src/models/Board';
import type { IssueRow, MrRow } from '../src/board/FactStore';
import {
    approvalsFromStore,
    cardFromIssue,
    gitLabMrsFromStore,
    isoTimestamp,
    mrCandidatesFromStore,
    restoredFreshness,
} from '../src/board/Restore';
import { resolveStage } from '../src/services/DeliveryStageResolver';
import { classify } from '../src/services/MrBoardResolver';

const COLUMNS: BoardColumn[] = [{ id: '1', name: 'In Progress', statusIds: ['3'] }];

function issue(overrides: Partial<IssueRow> & { key: string }): IssueRow {
    return {
        project: 'NEX2',
        sprintId: 521,
        statusId: '3',
        statusName: 'In Progress',
        type: 'Story',
        summary: 'restored card',
        priority: 'High',
        assignee: 'Me',
        epicKey: null,
        parentKey: null,
        commentCount: 4,
        rank: '0|i00001:',
        updatedAt: 1_700_000_000_000,
        ...overrides,
    };
}

function mrRow(overrides: Partial<MrRow> & { iid: number }): MrRow {
    return {
        project: 'group/repo',
        state: 'merged',
        title: `MR ${overrides.iid}`,
        sourceBranch: `bug-${overrides.iid}`,
        targetBranch: 'nexus/dev/7.10.x',
        authorId: 7,
        authorName: 'Alice',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        mergedAt: 1_700_000_100_000,
        mergeCommitSha: 'aaaa1111',
        draft: false,
        hasConflicts: null,
        blockingDiscussionsResolved: null,
        reviewerIds: [],
        webUrl: `https://gitlab/!${overrides.iid}`,
        approved: null,
        approvalsLeft: null,
        ...overrides,
    };
}

test('a restored card keeps the stored facts and starts without a stage', () => {
    const card = cardFromIssue(issue({ key: 'NEX2-1' }), COLUMNS, 'Me', (key) => `https://jira/${key}`);

    assert.equal(card.key, 'NEX2-1');
    assert.equal(card.columnName, 'In Progress');
    assert.equal(card.isMine, true);
    assert.equal(card.priority, 'High');
    assert.equal(card.commentCount, 4);
    assert.equal(card.updatedAtEpoch, 1_700_000_000_000);
    assert.equal(card.stage, null, 'derived state is never restored from the store');
    assert.equal(card.url, 'https://jira/NEX2-1');
});

test('a subtask is recognised from its stored parent key', () => {
    const card = cardFromIssue(issue({ key: 'NEX2-2', parentKey: 'NEX2-1' }), COLUMNS, null, () => '');
    assert.equal(card.isSubtask, true);
});

test('stored MR rows reconstitute the stage inputs, and the stage is recomputed', () => {
    const rows = [mrRow({ iid: 10, title: 'NEX2-1 fix', state: 'merged' })];
    const mrs = gitLabMrsFromStore(rows);
    const facts: MrFact[] = [
        {
            iid: 10,
            title: mrs[0].title,
            state: 'merged',
            url: mrs[0].webUrl,
            targetBranch: mrs[0].targetBranch,
            sourceBranch: mrs[0].sourceBranch,
            approved: false,
            approvedBy: [],
            approvalsLeft: null,
            approvalsKnown: true,
            mergedAt: mrs[0].mergedAt,
            mergeCommitSha: mrs[0].mergeCommitSha,
            matchedBy: 'title',
            isCardMr: true,
        },
    ];

    const result = resolveStage({
        tracked: true,
        dataOk: true,
        buildChannel: 'merge-only',
        mrs: facts,
        builds: [],
    });

    assert.equal(result.stage, 'merged');
});

test('an open MR restored from the store keeps its approval verdict instead of guessing', () => {
    const rows = [mrRow({ iid: 11, state: 'opened', approved: true, approvalsLeft: 0 })];
    const mr = rows[0];
    const approval = approvalsFromStore(
        [
            { project: 'group/repo', iid: 11, userId: 5, userName: 'Bob', approvedAt: 1_700_000_200_000 },
        ],
        mr
    );
    assert.ok(approval, 'a known approval verdict must come back');
    assert.equal(approval.approved, true);
    assert.equal(approval.approvalsLeft, 0);
    assert.deepEqual(approval.approvedByIds, [5]);
    assert.equal(approval.approvedAtById?.['5'], 1_700_000_200_000);
});

test('an approval verdict that was never fetched stays unknown, not "not approved"', () => {
    const unknown = approvalsFromStore([], mrRow({ iid: 12, state: 'opened', approved: null }));
    assert.equal(unknown, undefined);
});

test('the MR board rebuilds both columns from stored rows and approvals', () => {
    const rows = [
        mrRow({ iid: 20, state: 'opened', reviewerIds: [42], authorId: 7 }),
        mrRow({ iid: 21, state: 'opened', reviewerIds: [], authorId: 42 }),
    ];
    const approvals = new Map([
        ['group/repo!20', approvalsFromStore([], rows[0])],
        ['group/repo!21', approvalsFromStore([], rows[1])],
    ]);

    const result = classify({
        candidates: mrCandidatesFromStore(rows),
        viewerId: 42,
        approvals,
        jiraProjects: ['NEX2'],
    });

    assert.deepEqual(result.reviewQueue.map((card) => card.iid), [20]);
    assert.deepEqual(result.myMrs.map((card) => card.iid), [21]);
});

test('restored data is always marked stale until the network refresh lands', () => {
    assert.deepEqual(restoredFreshness(null), { lastSuccessAt: null, stale: false, error: null });
    assert.deepEqual(restoredFreshness(1_700_000_000_000), {
        lastSuccessAt: 1_700_000_000_000,
        stale: true,
        error: null,
    });
    assert.equal(isoTimestamp(null), undefined);
    assert.equal(isoTimestamp(0), '1970-01-01T00:00:00.000Z');
});
