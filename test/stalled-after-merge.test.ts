import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { MrFact } from '../src/models/Board';
import { STALLED_AFTER_DAYS, stalledAfterMerge } from '../src/services/StalledAfterMerge';

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

const NOW = Date.parse('2026-11-10T02:00:00Z');

test('exactly the threshold counts as stalled', () => {
    // 跨时区输入：+08:00 的 10:00 就是 UTC 的 02:00
    const merged = mr({ iid: 1, mergedAt: '2026-11-07T10:00:00+08:00' });
    assert.equal(stalledAfterMerge([merged], NOW)?.days, STALLED_AFTER_DAYS);
});

test('one minute short of the threshold is not stalled', () => {
    const merged = mr({ iid: 1, mergedAt: '2026-11-07T10:01:00+08:00' });
    assert.equal(stalledAfterMerge([merged], NOW), null);
});

test('the earliest merge across all associated MRs wins', () => {
    const older = mr({ iid: 1, mergedAt: '2026-11-01T00:00:00Z' });
    const newer = mr({ iid: 2, mergedAt: '2026-11-09T00:00:00Z' });
    assert.equal(stalledAfterMerge([newer, older], NOW)?.days, 9);
});

test('an unmerged MR contributes no merge time', () => {
    const opened = mr({ iid: 1, state: 'opened', mergedAt: undefined });
    assert.equal(stalledAfterMerge([opened], NOW), null);
});

test('no associated MR means no line at all', () => {
    assert.equal(stalledAfterMerge([], NOW), null);
});

test('a merge time that fails to parse is skipped, not treated as 1970', () => {
    const broken = mr({ iid: 1, mergedAt: 'not a date' });
    assert.equal(stalledAfterMerge([broken], NOW), null);
});
