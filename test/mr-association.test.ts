import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { GitLabMr } from '../src/services/GitLabService';
import { associateMrs } from '../src/services/MrAssociation';

const PROJECTS = ['NEX2', 'MAGR3', 'NEX', 'IB'];

function mr(overrides: Partial<GitLabMr> & { iid: number }): GitLabMr {
    return {
        state: 'merged',
        targetBranch: 'nexus/dev/7.10.x',
        sourceBranch: `bug-${overrides.iid}`,
        title: '',
        description: '',
        webUrl: `https://gitlab/!${overrides.iid}`,
        updatedAt: '2026-11-06T08:48:00Z',
        ...overrides,
    };
}

test('title is the primary signal, branch name is only the fallback', () => {
    const map = associateMrs(
        [
            mr({ iid: 3742, title: 'NEX2-891 fix on-spot', sourceBranch: 'bug-891' }),
            mr({ iid: 3703, title: 'noise', sourceBranch: 'story-NEX2-805' }),
        ],
        PROJECTS
    );

    assert.equal(map.get('NEX2-891')?.[0].matchedBy, 'title');
    assert.equal(map.get('NEX2-805')?.[0].matchedBy, 'branch');
});

test('one MR can deliver two issues written as NEX2-1038+1039', () => {
    const map = associateMrs([mr({ iid: 3749, title: 'NEX2-1038+1039 shared work' })], PROJECTS);
    assert.deepEqual([...map.keys()].sort(), ['NEX2-1038', 'NEX2-1039']);
    assert.equal(map.get('NEX2-1039')?.[0].mr.iid, 3749);
});

test('one issue can carry several MRs', () => {
    const map = associateMrs(
        [
            mr({ iid: 3720, title: 'NEX2-932 story part' }),
            mr({ iid: 3769, title: 'NEX2-932 task part' }),
        ],
        PROJECTS
    );
    assert.equal(map.get('NEX2-932')?.length, 2);
});

test('an MR without any key is ignored rather than attached to something', () => {
    const map = associateMrs([mr({ iid: 3753, title: 'task bfapc', sourceBranch: 'task-bfapc' })], PROJECTS);
    assert.equal(map.size, 0);
});

test('a description key is used only when the title has none', () => {
    const map = associateMrs(
        [mr({ iid: 3800, title: 'plain title', description: 'closes NEX-2591' })],
        PROJECTS
    );
    assert.equal(map.get('NEX-2591')?.[0].matchedBy, 'description');
});
