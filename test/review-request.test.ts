import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { buildReviewRequest } from '../src/services/MrReviewHandoff';

const target = {
    iid: 1234,
    title: 'NEX2-1038 fix the thing',
    url: 'https://gitlab.example/group/repo/-/merge_requests/1234',
};

test('with a local diff the instruction points at the file and forbids reviewing the workspace', () => {
    const text = buildReviewRequest(target, 'E:/work/.scratch/mr-board/diffs/!1234.diff');
    assert.match(text, /\/code-review/);
    assert.match(text, /!1234/);
    assert.match(text, new RegExp(target.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(text, /!1234\.diff/);
    assert.match(text, /不要审当前工作区/);
});

test('without a diff the instruction falls back to the GitLab MCP tool', () => {
    const text = buildReviewRequest(target);
    assert.match(text, /\/code-review/);
    assert.match(text, /gitlab_get_mr_diff/);
    assert.match(text, /不要审当前工作区/);
    assert.doesNotMatch(text, /\.diff/);
});
