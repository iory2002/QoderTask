import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { fingerprint } from '../src/board/fingerprint';

test('identical data produces the same revision, so the webview can skip a repaint', () => {
    const payload = JSON.stringify({ columns: [{ id: '0', name: 'To Do', statusIds: ['1'] }], cards: [] });
    assert.equal(fingerprint(payload), fingerprint(payload));
});

test('a changed card set produces a different revision', () => {
    const before = fingerprint(JSON.stringify({ cards: [] }));
    const after = fingerprint(JSON.stringify({ cards: [{ key: 'NEX2-1' }] }));
    assert.notEqual(before, after);
});

test('a freshness flip alone also changes the revision', () => {
    const fresh = fingerprint(JSON.stringify({ cards: [], stale: false, error: null }));
    const stale = fingerprint(JSON.stringify({ cards: [], stale: true, error: 'boom' }));
    assert.notEqual(fresh, stale);
});
