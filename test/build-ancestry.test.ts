import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { BuildFact, MrFact } from '../src/models/Board';
import {
    buildsWorthChecking,
    buildContainsMerge,
    containmentKey,
    newlyIntroducedCount,
    resolveContainment,
} from '../src/services/BuildAncestry';

function mr(overrides: Partial<MrFact> & { iid: number }): MrFact {
    return {
        title: '',
        state: 'merged',
        url: '',
        targetBranch: 'nexus/dev/7.10.x',
        sourceBranch: '',
        approved: false,
        approvedBy: [],
        approvalsLeft: null,
        approvalsKnown: true,
        matchedBy: 'title',
        isCardMr: false,
        ...overrides,
    };
}

function build(number: number, timestamp: string, result: string | null, sha: string): BuildFact {
    return { number, result, timestamp: Date.parse(timestamp), branch: 'nexus/dev/7.10.x', url: `job/${number}/`, sha };
}

test('only the newest success and the newest finished build are worth asking about', () => {
    const builds = [
        build(1, '2026-11-01T00:00:00Z', 'SUCCESS', 'a1'),
        build(2, '2026-11-02T00:00:00Z', 'SUCCESS', 'b2'),
        build(3, '2026-11-03T00:00:00Z', 'FAILURE', 'c3'),
        build(4, '2026-11-04T00:00:00Z', null, 'd4'),
    ];

    assert.deepEqual(
        buildsWorthChecking(builds).map((entry) => entry.number),
        [2, 3]
    );
});

test('buildContainsMerge compares the merge base to the merge commit', async () => {
    // 每个用例用自己的仓库名：merge_base 结果按（仓库, SHA 对）在进程内缓存
    const contained = await buildContainsMerge(
        { getMergeBase: async () => 'aaaa1111' },
        'group/contained',
        'aaaa1111',
        'bbbb2222'
    );
    const notContained = await buildContainsMerge(
        { getMergeBase: async () => 'cccc3333' },
        'group/not-contained',
        'aaaa1111',
        'bbbb2222'
    );

    assert.equal(contained, true);
    assert.equal(notContained, false);
});

test('a failed merge_base call is unknown, never false', async () => {
    const verdict = await buildContainsMerge(
        {
            getMergeBase: async () => {
                throw new Error('GitLab 404');
            },
        },
        'group/failing',
        'dddd4444',
        'eeee5555'
    );

    assert.equal(verdict, null);
});

test('a merge already covered by the previous success is not "newly introduced"', async () => {
    const known = mr({ iid: 1, mergeCommitSha: 'aaaa' });
    const fresh = mr({ iid: 2, mergeCommitSha: 'bbbb' });
    const success = build(10, '2026-11-01T00:00:00Z', 'SUCCESS', 's10');
    const failure = build(11, '2026-11-02T00:00:00Z', 'FAILURE', 'f11');

    const containment = new Map([
        [containmentKey(known, success), true],
        [containmentKey(known, failure), true],
        [containmentKey(fresh, success), false],
        [containmentKey(fresh, failure), true],
    ]);

    assert.equal(newlyIntroducedCount([known, fresh], [success, failure], containment), 1);
});

test('resolveContainment dedupes identical SHA pairs but fills every card', async () => {
    const first = mr({ iid: 1, mergeCommitSha: 'aaaa' });
    const second = mr({ iid: 2, mergeCommitSha: 'aaaa' });
    const success = build(10, '2026-11-01T00:00:00Z', 'SUCCESS', 's10');

    let calls = 0;
    const containment = await resolveContainment({
        gitlab: {
            getMergeBase: async () => {
                calls += 1;
                return 'aaaa';
            },
        },
        project: 'group/repo',
        mrs: [first, second],
        builds: [success],
    });

    assert.equal(calls, 1);
    assert.equal(containment.get(containmentKey(first, success)), true);
    assert.equal(containment.get(containmentKey(second, success)), true);
});
