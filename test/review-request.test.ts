import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { countChangedLines } from '../src/services/DiffFacts';
import { buildReviewRequest, sensitiveLabels } from '../src/services/MrReviewHandoff';

const target = {
    iid: 1234,
    title: 'NEX2-1038 fix the thing',
    url: 'https://gitlab.example/group/repo/-/merge_requests/1234',
};

test('with a local diff the instruction points at the file and forbids reviewing the workspace', () => {
    const text = buildReviewRequest({ ...target, diffPath: 'E:/work/.scratch/mr-board/diffs/!1234.diff' });
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

test('the brief spells out file count, line counts, directories, sensitive hits, keys and approvals', () => {
    const text = buildReviewRequest({
        ...target,
        diffPath: '/tmp/!1234.diff',
        files: [
            { path: 'src/models/Board.ts', additions: 12, deletions: 3 },
            { path: 'src/services/GitLabService.ts', additions: 20, deletions: 4 },
            { path: 'package.json', additions: 2, deletions: 1 },
        ],
        jiraKeys: ['NEX2-1038', 'NEX2-1039'],
        approvalsKnown: true,
        approvedBy: ['Alice'],
        approvalsLeft: 1,
    });

    assert.match(text, /改动 3 个文件，\+34 \/ -8 行/);
    assert.match(text, /目录：src\/models（1）、src\/services（1）、（根目录）（1）/);
    assert.match(text, /敏感变更：依赖清单（package\.json）；扩展与前端共享类型（src\/models\/Board\.ts）/);
    assert.match(text, /关联 Jira：NEX2-1038、NEX2-1039/);
    assert.match(text, /批准：Alice（还差 1 个批准）/);
});

test('a category with no facts is omitted instead of being written as "none"', () => {
    const text = buildReviewRequest({ ...target, diffPath: '/tmp/!1234.diff' });

    assert.doesNotMatch(text, /事实：/);
    assert.doesNotMatch(text, /目录/);
    assert.doesNotMatch(text, /敏感变更/);
    assert.doesNotMatch(text, /关联 Jira/);
    assert.doesNotMatch(text, /批准/);
});

test('a failed diff keeps the link-only instruction and never invents facts', () => {
    const text = buildReviewRequest({ ...target, files: undefined });

    assert.match(text, /gitlab_get_mr_diff/);
    assert.doesNotMatch(text, /^- 改动/m);
    assert.doesNotMatch(text, /事实：/);
});

test('a truncated diff is described as a lower bound', () => {
    const text = buildReviewRequest({
        ...target,
        diffPath: '/tmp/!1234.diff',
        files: [{ path: 'src/a.ts', additions: 1, deletions: 0 }],
        filesTruncated: true,
    });

    assert.match(text, /改动 至少 1 个文件/);
});

test('an unknown approvals state is left out entirely', () => {
    const text = buildReviewRequest({ ...target, approvalsKnown: false, approvedBy: ['Alice'] });
    assert.doesNotMatch(text, /批准/);
});

test('the sensitive rule set covers build files, manifests, build scripts, shared types and SQL', () => {
    assert.deepEqual(sensitiveLabels('app/foo.vcxproj'), ['构建工程文件']);
    assert.deepEqual(sensitiveLabels('app/foo.vcxproj.filters'), ['构建工程文件']);
    assert.deepEqual(sensitiveLabels('package-lock.json'), ['依赖清单']);
    assert.deepEqual(sensitiveLabels('scripts/build-webview.js'), ['构建脚本']);
    assert.deepEqual(sensitiveLabels('webpack.config.js'), ['构建脚本']);
    assert.deepEqual(sensitiveLabels('src/models/MrBoard.ts'), ['扩展与前端共享类型']);
    assert.deepEqual(sensitiveLabels('db/migrations/0001-init.sql'), ['SQL 与迁移']);
    assert.deepEqual(sensitiveLabels('src/board/BoardState.ts'), []);
});

test('line counting ignores the +++ and --- file headers', () => {
    const diff = ['--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,2 +1,3 @@', '-old', '+new', '+added'].join('\n');
    assert.deepEqual(countChangedLines(diff), { additions: 2, deletions: 1 });
});
