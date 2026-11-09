import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { parseScopeLine, parseScopeLines } from '../src/services/MrScopeParser';

test('a well-formed line splits on the last @', () => {
    assert.deepEqual(parseScopeLine('ultrasoundgeneralimaging/gipc-app@nexus/dev/7.10.x'), {
        gitlabProject: 'ultrasoundgeneralimaging/gipc-app',
        targetBranch: 'nexus/dev/7.10.x',
    });
});

test('spaces around the parts are trimmed', () => {
    assert.deepEqual(parseScopeLine('  group/repo @ main  '), {
        gitlabProject: 'group/repo',
        targetBranch: 'main',
    });
});

test('a line without @ is rejected', () => {
    assert.equal(parseScopeLine('group/repo'), null);
});

test('a line with an empty branch is rejected', () => {
    assert.equal(parseScopeLine('group/repo@'), null);
    assert.equal(parseScopeLine('@main'), null);
});

test('blank lines are skipped, duplicates collapse, invalid lines are reported', () => {
    const result = parseScopeLines([
        'group/repo@main',
        '  ',
        'group/repo@main',
        'group/other@release/1.0',
        'broken-line',
    ]);
    assert.equal(result.entries.length, 2);
    assert.deepEqual(result.invalid, ['broken-line']);
});
