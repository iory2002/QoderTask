import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { BoardCard } from '../src/models/Board';
import type { MrCard, MrReviewState } from '../src/models/MrBoard';
import { countJiraBadges, countMrBadges, jiraBadgeLabels, mrBadgeLabels } from '../src/services/BadgeCounter';

function card(overrides: Partial<BoardCard> & { key: string }): BoardCard {
    return {
        project: 'NEX2',
        summary: '',
        issueType: 'Story',
        priority: null,
        statusId: '1',
        statusName: 'Open',
        columnName: 'To Do',
        epicKey: null,
        epicLabel: null,
        rank: '',
        assignee: null,
        isMine: true,
        pinned: false,
        isSubtask: false,
        commentCount: 0,
        updatedAtEpoch: null,
        stage: null,
        buildFailed: false,
        buildChannel: 'none',
        mrs: [],
        evidence: [],
        url: '',
        ...overrides,
    };
}

function mr(iid: number, reviewState: MrReviewState): MrCard {
    return {
        iid,
        projectPath: 'ultrasoundgeneralimaging/gipc-app',
        title: '',
        url: '',
        sourceBranch: '',
        targetBranch: 'nexus/dev/7.10.x',
        author: { id: 1, name: 'me', username: 'me' },
        approvedBy: [],
        approvalsLeft: null,
        approvalsKnown: true,
        hasConflicts: null,
        blockingDiscussionsResolved: null,
        createdAt: '',
        updatedAt: '',
        reviewState,
        jiraKeys: [],
    };
}

const JIRA = {
    mode: 'development' as const,
    onlyMine: true,
    developmentStatuses: ['Open', 'In Progress', 'In review', 'In Code Review'],
    testingStatuses: ['In Test'],
};

test('jira badge groups cards by status name, not by board column', () => {
    const counts = countJiraBadges(
        [
            card({ key: 'NEX2-1', statusName: 'Open' }),
            card({ key: 'NEX2-2', statusName: 'In Code Review', columnName: 'In Test' }),
            card({ key: 'NEX2-3', statusName: 'In Test' }),
            card({ key: 'NEX2-4', statusName: 'Done' }),
        ],
        JIRA
    );

    assert.deepEqual(counts, { primary: 2, secondary: 1 });
});

test('jira badge ignores status name case and surrounding spaces', () => {
    const counts = countJiraBadges(
        [card({ key: 'NEX2-1', statusName: ' in progress ' }), card({ key: 'NEX2-2', statusName: 'in test' })],
        JIRA
    );

    assert.deepEqual(counts, { primary: 1, secondary: 1 });
});

test('jira badge can count everyone, and can put testing on the icon', () => {
    const cards = [
        card({ key: 'NEX2-1', statusName: 'Open' }),
        card({ key: 'NEX2-2', statusName: 'Open', isMine: false }),
        card({ key: 'NEX2-3', statusName: 'In Test', isMine: false }),
    ];

    assert.deepEqual(countJiraBadges(cards, JIRA), { primary: 1, secondary: 0 });
    assert.deepEqual(countJiraBadges(cards, { ...JIRA, onlyMine: false }), { primary: 2, secondary: 1 });
    assert.deepEqual(countJiraBadges(cards, { ...JIRA, onlyMine: false, mode: 'testing' }), {
        primary: 1,
        secondary: 2,
    });
});

test('gitlab badge: review queue is the default number, own unreviewed MRs the other', () => {
    const queue = [mr(1, 'awaiting-me'), mr(2, 'unknown')];
    const mine = [mr(3, 'unreviewed'), mr(4, 'reviewed')];

    assert.deepEqual(countMrBadges(queue, mine, 'reviewQueue'), { primary: 2, secondary: 1 });
    assert.deepEqual(countMrBadges(queue, mine, 'awaitingOthers'), { primary: 1, secondary: 2 });
});

test('badge labels follow the mode so the sidebar numbers never swap', () => {
    assert.deepEqual(jiraBadgeLabels('development'), ['开发中', '测试中']);
    assert.deepEqual(jiraBadgeLabels('testing'), ['测试中', '开发中']);
    assert.deepEqual(mrBadgeLabels('reviewQueue'), ['待我审', '等别人审']);
    assert.deepEqual(mrBadgeLabels('awaitingOthers'), ['等别人审', '待我审']);
});

test('gitlab badge keeps approvals-unknown MRs in the count', () => {
    const queue: MrCard[] = [];
    const mine = [mr(1, 'reviewed'), mr(2, 'reviewed'), mr(3, 'unknown')];

    assert.deepEqual(countMrBadges(queue, mine, 'awaitingOthers'), { primary: 1, secondary: 0 });
});
