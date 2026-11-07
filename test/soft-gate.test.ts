import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { BoardCard } from '../src/models/Board';
import { checkSoftGate } from '../src/board/softGate';

function card(overrides: Partial<BoardCard>): BoardCard {
    return {
        key: 'NEX2-932',
        project: 'NEX2',
        summary: 's',
        issueType: 'Bug',
        priority: null,
        statusId: '3',
        columnName: 'In Progress',
        epicKey: null,
        epicLabel: null,
        rank: '',
        assignee: null,
        isSubtask: false,
        commentCount: 0,
        stage: 'merged',
        buildFailed: false,
        buildChannel: 'full',
        mrs: [],
        evidence: [],
        url: 'u',
        ...overrides,
    };
}

test('a merged card walks into In Test without a gate', () => {
    assert.equal(checkSoftGate(card({ stage: 'merged' }), 'In Test').required, false);
});

test('an unsubmitted card is stopped with the missing merge spelled out', () => {
    const gate = checkSoftGate(card({ stage: 'none' }), 'In Test');
    assert.equal(gate.required, true);
    assert.match(gate.items[0], /合入记录/);
    assert.match(gate.consequence, /测试中/);
});

test('an approved but unmerged card is stopped', () => {
    const gate = checkSoftGate(card({ stage: 'approved' }), 'In Test');
    assert.equal(gate.required, true);
    assert.match(gate.items[0], /批准/);
});

test('an unknown stage is stopped rather than assumed fine', () => {
    const gate = checkSoftGate(card({ stage: 'unknown' }), 'In Test');
    assert.equal(gate.required, true);
    assert.match(gate.items[0], /取数失败/);
});

test('a failed build warns even though the merge already happened', () => {
    const gate = checkSoftGate(
        card({ stage: 'merged', buildFailed: true, build: { number: 246, result: 'FAILURE', timestamp: 0, branch: 'b', url: 'u' } }),
        'In Test'
    );
    assert.equal(gate.required, true);
    assert.match(gate.items.join('\n'), /#246/);
});

test('an untracked project cannot be judged, so no gate is raised', () => {
    assert.equal(checkSoftGate(card({ stage: null }), 'In Test').required, false);
});

test('the gate only applies to In Test', () => {
    assert.equal(checkSoftGate(card({ stage: 'none' }), 'Done').required, false);
});
