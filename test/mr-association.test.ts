import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { GitLabMr } from '../src/services/GitLabService';
import { associateMrs, associateMrsIncludingCommits, commitSubjectsToKeys } from '../src/services/MrAssociation';

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
        hasConflicts: null,
        blockingDiscussionsResolved: null,
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

test('commit subjects rescue an MR that names no key anywhere else', async () => {
    const map = await associateMrsIncludingCommits({
        gitlabProject: 'group/app',
        jiraProjects: PROJECTS,
        mrs: [mr({ iid: 3801, title: 'fix on-spot', sourceBranch: 'bug-fix-on-spot' })],
        fetchCommits: async () => [
            'NEX2-950 keep the page in step with the active tab',
            'SPRS<00000>NEX2-954: follow up',
        ],
    });

    assert.equal(map.get('NEX2-950')?.[0].matchedBy, 'commit');
    assert.equal(map.get('NEX2-954')?.[0].mr.iid, 3801);
});

test('commit fallback is never consulted when the title already names an issue', async () => {
    let calls = 0;
    const map = await associateMrsIncludingCommits({
        gitlabProject: 'group/app',
        jiraProjects: PROJECTS,
        mrs: [mr({ iid: 3802, title: 'NEX2-950: main fix' })],
        fetchCommits: async () => {
            calls += 1;
            return ['NEX2-954 also in this branch'];
        },
    });

    assert.equal(calls, 0);
    assert.equal(map.has('NEX2-954'), false);
});

test('only the commit subject counts, and merge/revert subjects are skipped', () => {
    assert.deepEqual(
        commitSubjectsToKeys(
            [
                "Merge branch 'NEX2-950-fix' into nexus/dev/7.10.x",
                'Revert "NEX2-951: undo the fix"',
                'NEX2-952: real work\n\nrefs NEX2-953 only in the body',
            ],
            PROJECTS
        ),
        ['NEX2-952']
    );
});

test('only the most recently updated unassociated MRs are looked up', async () => {
    const requested: number[] = [];
    await associateMrsIncludingCommits({
        gitlabProject: 'group/app',
        jiraProjects: PROJECTS,
        mrs: [
            mr({ iid: 3811, updatedAt: '2026-11-01T00:00:00Z' }),
            mr({ iid: 3812, updatedAt: '2026-11-05T00:00:00Z' }),
            mr({ iid: 3813, updatedAt: '2026-11-09T00:00:00Z' }),
        ],
        fetchCommits: async (iid) => {
            requested.push(iid);
            return [`NEX2-${iid}`];
        },
        maxLookups: 2,
    });

    assert.deepEqual(requested.sort((left, right) => left - right), [3812, 3813]);
});

test('a failing commit request does not affect the other associations', async () => {
    const map = await associateMrsIncludingCommits({
        gitlabProject: 'group/app',
        jiraProjects: PROJECTS,
        mrs: [
            mr({ iid: 3821, title: 'NEX2-100: named in the title' }),
            mr({ iid: 3822 }),
            mr({ iid: 3823 }),
        ],
        maxLookups: 2,
        fetchCommits: async (iid) => {
            if (iid === 3822) {
                throw new Error('boom');
            }
            return ['NEX2-111 from a commit subject'];
        },
        onError: () => undefined,
    });

    assert.equal(map.get('NEX2-100')?.[0].matchedBy, 'title');
    assert.equal(map.get('NEX2-111')?.[0].matchedBy, 'commit');
});
