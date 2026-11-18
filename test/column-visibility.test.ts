import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { hiddenColumnIdsOf, hiddenColumnNamesOf, unmatchedHiddenColumns } from '../src/board/columnVisibility';
import type { BoardColumn } from '../src/models/Board';

const COLUMNS: BoardColumn[] = [
    { id: '1', name: 'To Do', statusIds: ['101'] },
    { id: '2', name: 'In Progress', statusIds: ['102'] },
    { id: '3', name: 'In Code Review', statusIds: ['103'] },
    { id: '4', name: 'In Test', statusIds: ['104'] },
    { id: '5', name: 'Done', statusIds: ['105'] },
];

test('hides exactly the columns the user listed', () => {
    assert.deepEqual(hiddenColumnIdsOf(COLUMNS, ['To Do', 'In Progress']), ['1', '2']);
});

test('column names ignore case and spacing', () => {
    assert.deepEqual(hiddenColumnIdsOf(COLUMNS, [' to   DO ', 'in code review']), ['1', '3']);
});

test('an empty list hides nothing, so the default board is unchanged', () => {
    assert.deepEqual(hiddenColumnIdsOf(COLUMNS, []), []);
    assert.deepEqual(hiddenColumnIdsOf(COLUMNS, ['   ']), []);
});

test('unknown names match nothing instead of hiding everything', () => {
    assert.deepEqual(hiddenColumnIdsOf(COLUMNS, ['Todo', 'Review']), []);
});

test('a column id still works after the column is renamed in Jira', () => {
    assert.deepEqual(hiddenColumnIdsOf(COLUMNS, ['5']), ['5']);
});

test('unmatched names are reported so the user can fix a typo', () => {
    assert.deepEqual(unmatchedHiddenColumns(COLUMNS, ['To Do', 'In Progess']), ['In Progess']);
});

test('nothing is reported before the board columns are known', () => {
    assert.deepEqual(unmatchedHiddenColumns([], ['To Do']), []);
});

test('the view menu turns the visible list back into hidden names', () => {
    assert.deepEqual(hiddenColumnNamesOf(COLUMNS, ['1', '3', '4', '5']), ['In Progress']);
});

test('checking every column hides nothing, so the setting stays empty', () => {
    assert.deepEqual(
        hiddenColumnNamesOf(
            COLUMNS,
            COLUMNS.map((column) => column.id)
        ),
        []
    );
});

test('unknown ids in the visible list do not hide or resurrect anything', () => {
    assert.deepEqual(hiddenColumnNamesOf(COLUMNS, ['1', '999']), [
        'In Progress',
        'In Code Review',
        'In Test',
        'Done',
    ]);
});

test('an empty board definition has no columns to hide', () => {
    assert.deepEqual(hiddenColumnNamesOf([], ['1']), []);
});
