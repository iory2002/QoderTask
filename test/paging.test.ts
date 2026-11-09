import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { MAX_PAGES, fetchAllPages } from '../src/services/paging';

/** 造一个「一共 total 条、每页 100 条」的假 GitLab，并记录被翻了几页 */
function pagesOf(total: number, pageSize = 100) {
    const calls: number[] = [];
    const fetchPage = async (page: number) => {
        calls.push(page);
        const start = (page - 1) * pageSize;
        return Array.from({ length: Math.max(0, Math.min(pageSize, total - start)) }, (_, index) => start + index);
    };
    return { calls, fetchPage };
}

test('a short first page ends the walk after one request', async () => {
    const { calls, fetchPage } = pagesOf(30);
    const result = await fetchAllPages(fetchPage);

    assert.equal(result.rows.length, 30);
    assert.equal(result.truncated, false);
    assert.deepEqual(calls, [1]);
});

test('90 days at 280 rows takes three pages and is not truncated', async () => {
    const { calls, fetchPage } = pagesOf(280);
    const result = await fetchAllPages(fetchPage);

    assert.equal(result.rows.length, 280);
    assert.equal(result.truncated, false);
    assert.deepEqual(calls, [1, 2, 3]);
});

test('an exactly full page still asks for the next one', async () => {
    const { calls, fetchPage } = pagesOf(200);
    const result = await fetchAllPages(fetchPage);

    assert.equal(result.rows.length, 200);
    assert.equal(result.truncated, false);
    assert.deepEqual(calls, [1, 2, 3]);
});

test('exactly the cap (1000 rows) is complete, not truncated', async () => {
    const { calls, fetchPage } = pagesOf(1000);
    const result = await fetchAllPages(fetchPage);

    assert.equal(result.rows.length, 1000);
    assert.equal(result.truncated, false);
    // 翻满 10 页后再探一次空页，证明没有第 11 页
    assert.equal(calls.length, MAX_PAGES + 1);
});

test('over the cap (1001 rows) stops and reports truncation instead of pretending', async () => {
    const { calls, fetchPage } = pagesOf(1001);
    const result = await fetchAllPages(fetchPage);

    assert.equal(result.rows.length, 1000);
    assert.equal(result.truncated, true);
    assert.equal(calls.length, MAX_PAGES + 1);
});

test('a page that throws is not swallowed and leaves nothing behind', async () => {
    const fetchPage = async (page: number) => {
        if (page === 2) {
            throw new Error('GitLab 502');
        }
        return Array.from({ length: 100 }, (_, index) => index);
    };

    await assert.rejects(() => fetchAllPages(fetchPage), /GitLab 502/);
});
