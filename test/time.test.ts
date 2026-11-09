import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { epochOf, isAtOrAfter } from '../src/services/time';

test('+08:00 and the equivalent UTC instant parse to the same epoch', () => {
    const shanghai = epochOf('2026-11-09T20:55:00+08:00');
    const utc = epochOf('2026-11-09T12:55:00Z');

    assert.equal(shanghai, utc);
    assert.equal(shanghai, Date.UTC(2026, 10, 9, 12, 55, 0));
});

test('an offset timestamp is compared by instant, not by its first 16 characters', () => {
    // 字符串比较会认为这里「2026-11-09T20:55」晚于「2026-11-10T01:00」之前，实际相反
    const merged = epochOf('2026-11-09T20:55:00+08:00');
    const build = epochOf('2026-11-10T01:00:00+08:00');

    assert.ok(merged !== null && build !== null);
    assert.ok(merged < build);
});

test('missing or unparsable input is null, never zero', () => {
    assert.equal(epochOf(undefined), null);
    assert.equal(epochOf(null), null);
    assert.equal(epochOf(''), null);
    assert.equal(epochOf('not a date'), null);
});

test('an already numeric value is treated as epoch milliseconds', () => {
    assert.equal(epochOf(1_700_000_000_000), 1_700_000_000_000);
    assert.equal(epochOf(Number.NaN), null);
});

test('isAtOrAfter treats a failed parse as "not after"', () => {
    assert.equal(isAtOrAfter('2026-11-09T12:55:00Z', '2026-11-09T20:55:00+08:00'), true);
    assert.equal(isAtOrAfter('2026-11-09T12:54:59Z', '2026-11-09T20:55:00+08:00'), false);
    assert.equal(isAtOrAfter(undefined, '2026-11-09T12:55:00Z'), false);
    assert.equal(isAtOrAfter('2026-11-09T12:55:00Z', undefined), false);
});
