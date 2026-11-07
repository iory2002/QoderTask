import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { BoardColumn } from '../src/models/Board';
import { computeDropRules } from '../src/board/dropRules';

const COLUMNS: BoardColumn[] = [
    { id: '0', name: 'To Do', statusIds: ['1', '10701'] },
    { id: '1', name: 'In Progress', statusIds: ['3', '10700'] },
    { id: '2', name: 'In Code Review', statusIds: ['10101'] },
    { id: '3', name: 'In Test', statusIds: ['10401'] },
    { id: '4', name: 'Done', statusIds: ['10500', '5'] },
];

function dropTarget(statusId: string, transitions: Array<{ id: string; name: string; toStatusId: string }>) {
    return computeDropRules({ columns: COLUMNS, currentStatusId: statusId, transitions });
}

test('a bug in In Progress may go straight to In Test', () => {
    const rules = dropTarget('3', [{ id: '21', name: 'Send to Test', toStatusId: '10401' }]);
    const inTest = rules.find((rule) => rule.columnId === '3');
    assert.equal(inTest?.legal, true);
    assert.equal(inTest?.transitionName, 'Send to Test');
});

test('a story in In Progress is rejected for In Test and told where it can go', () => {
    const rules = dropTarget('3', [{ id: '151', name: 'Review Code', toStatusId: '10101' }]);
    const inTest = rules.find((rule) => rule.columnId === '3');
    assert.equal(inTest?.legal, false);
    assert.match(inTest?.reason ?? '', /没有直达「In Test」/);
    assert.match(inTest?.reason ?? '', /In Code Review/);
});

test('a task can reach Done in one step (Resolve)', () => {
    const rules = dropTarget('3', [
        { id: '21', name: 'Send to Test', toStatusId: '10401' },
        { id: '91', name: 'Resolve', toStatusId: '5' },
    ]);
    assert.equal(rules.find((rule) => rule.columnId === '4')?.legal, true);
});

test('dragging backwards is refused and points at Jira', () => {
    const rules = dropTarget('10401', [{ id: '141', name: 'Revert', toStatusId: '1' }]);
    const toDo = rules.find((rule) => rule.columnId === '0');
    assert.equal(toDo?.legal, false);
    assert.match(toDo?.reason ?? '', /回退/);
});

test('the current column is never a drop target', () => {
    const rules = dropTarget('3', []);
    assert.equal(rules.find((rule) => rule.columnId === '1')?.legal, false);
});

test('a status outside every column can still be dragged forward', () => {
    const rules = computeDropRules({
        columns: COLUMNS,
        currentStatusId: '10301',
        transitions: [{ id: '11', name: 'Start', toStatusId: '3' }],
    });
    assert.equal(rules.find((rule) => rule.columnId === '1')?.legal, true);
});
