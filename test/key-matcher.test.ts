import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { extractJiraKeys } from '../src/services/JiraKeyMatcher';

const PROJECTS = ['NEX2', 'MAGR3', 'NEX', 'IB'];

test('reads a key out of a title', () => {
    assert.deepEqual(extractJiraKeys('[NEX2-932] merge on-spot configuration', PROJECTS), ['NEX2-932']);
});

test('prefers the longest project prefix, so NEX2 never degrades to NEX', () => {
    assert.deepEqual(extractJiraKeys('NEX2-1038 fixes NEX-2591', PROJECTS), ['NEX2-1038', 'NEX-2591']);
});

test('inherits the project prefix for +1039 shorthand', () => {
    assert.deepEqual(extractJiraKeys('NEX2-1038+1039 deliver both', PROJECTS), ['NEX2-1038', 'NEX2-1039']);
});

test('inherits across several comma separated numbers', () => {
    assert.deepEqual(extractJiraKeys('NEX2-1038, 1039, 1040', PROJECTS), [
        'NEX2-1038',
        'NEX2-1039',
        'NEX2-1040',
    ]);
});

test('ignores look-alike strings outside the project whitelist', () => {
    assert.deepEqual(extractJiraKeys('blocked by C1-6 and L3-12 and ML6-15', PROJECTS), []);
});

test('does not match a key glued to a longer word', () => {
    assert.deepEqual(extractJiraKeys('XNEX2-932', PROJECTS), []);
});

test('dedupes repeated keys', () => {
    assert.deepEqual(extractJiraKeys('NEX2-932 then NEX2-932 again', PROJECTS), ['NEX2-932']);
});

test('returns nothing for empty text', () => {
    assert.deepEqual(extractJiraKeys(null, PROJECTS), []);
    assert.deepEqual(extractJiraKeys('', PROJECTS), []);
});

test('no projects configured means no matches', () => {
    assert.deepEqual(extractJiraKeys('NEX2-932', []), []);
});
