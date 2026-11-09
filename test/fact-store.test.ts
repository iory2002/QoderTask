import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { FactStore, loadSqlite } from '../src/board/FactStore';
import type { BoardCard, BuildFact } from '../src/models/Board';

const SCOPE = 'jira:board23';

function card(overrides: Partial<BoardCard> & { key: string }): BoardCard {
    return {
        project: 'NEX2',
        summary: 'a card',
        issueType: 'Story',
        priority: 'High',
        statusId: '3',
        statusName: 'In Progress',
        columnName: 'In Progress',
        epicKey: null,
        epicLabel: null,
        rank: '0|i00001:',
        assignee: 'me',
        isMine: true,
        pinned: false,
        isSubtask: false,
        commentCount: 2,
        updatedAtEpoch: null,
        stage: 'merged',
        buildFailed: true,
        buildChannel: 'full',
        mergedDaysAgo: 4,
        mrs: [],
        evidence: ['derived'],
        url: 'https://jira/browse/' + overrides.key,
        ...overrides,
    };
}

function jiraSnapshot(cards: BoardCard[]) {
    return {
        boardId: 23,
        columns: [{ id: '1', name: 'In Progress', statusIds: ['3'] }],
        rankField: 'customfield_10005',
        sprint: { id: 521, name: 'Sprint (11.18)', state: 'active', startAt: 1_700_000_000_000, endAt: null },
        cards,
    };
}

function build(number: number, result: string | null, sha: string): BuildFact {
    return {
        number,
        result,
        timestamp: 1_700_000_000_000 + number * 1000,
        branch: 'nexus/dev/7.10.x',
        url: `job/${number}/`,
        sha,
    };
}

function withStore<T>(work: (store: FactStore, path: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), 'facts-'));
    const path = join(dir, 'facts.sqlite');
    const store = FactStore.open(path);
    assert.ok(store, 'the fact store should open');
    try {
        return work(store, path);
    } finally {
        store.close();
        rmSync(dir, { recursive: true, force: true });
    }
}

test('node:sqlite is available in this runtime', () => {
    assert.ok(loadSqlite(), 'the host runtime must provide node:sqlite');
});

test('a fresh database is at user_version 1 and records first_seen_at', () => {
    withStore((store) => {
        assert.equal(store.schemaVersion(), 1);
        assert.ok(Number(store.meta('first_seen_at') ?? 0) > 0);
    });
});

test('replacing a jira scope leaves exactly this snapshot', () => {
    withStore((store) => {
        assert.equal(store.replaceJira(SCOPE, jiraSnapshot([card({ key: 'NEX2-1' }), card({ key: 'NEX2-2' })])), true);
        assert.deepEqual(store.issuesOf(SCOPE).map((issue) => issue.key).sort(), ['NEX2-1', 'NEX2-2']);

        // 第二次快照少了一张卡：库里不能留下脏行
        assert.equal(store.replaceJira(SCOPE, jiraSnapshot([card({ key: 'NEX2-2' })])), true);
        assert.deepEqual(store.issuesOf(SCOPE).map((issue) => issue.key), ['NEX2-2']);
    });
});

test('issue times are stored as epoch integers', () => {
    withStore((store) => {
        store.replaceJira(
            SCOPE,
            jiraSnapshot([card({ key: 'NEX2-9', updatedAtEpoch: Date.parse('2026-11-09T20:55:00+08:00') })])
        );

        const issue = store.issuesOf(SCOPE)[0];
        assert.equal(issue.updatedAt, Date.UTC(2026, 10, 9, 12, 55, 0));
        assert.equal(typeof issue.updatedAt, 'number');
    });
});

test('build history keeps the newest 200 builds per job', () => {
    withStore((store) => {
        const builds = Array.from({ length: 205 }, (_, index) => build(index + 1, 'SUCCESS', `sha${index + 1}`));
        assert.equal(store.upsertBuilds('job/a', builds), true);

        const kept = store.buildsOf('job/a');
        assert.equal(kept.length, 200);
        assert.equal(kept[0].number, 6, 'the five oldest are dropped');
        assert.equal(kept[kept.length - 1].number, 205);
    });
});

test('upserting the same build number never duplicates it', () => {
    withStore((store) => {
        store.upsertBuilds('job/a', [build(10, null, 'sha10')]);
        store.upsertBuilds('job/a', [build(10, 'SUCCESS', 'sha10')]);

        const kept = store.buildsOf('job/a');
        assert.equal(kept.length, 1);
        assert.equal(kept[0].result, 'SUCCESS');
    });
});

test('a failed replacement rolls back facts and freshness together', () => {
    withStore((store) => {
        store.replaceJira(SCOPE, jiraSnapshot([card({ key: 'NEX2-1' })]));
        const before = store.lastSuccessAt(SCOPE);

        // key 为 null 违反主键约束：整次替换必须回滚
        const broken = jiraSnapshot([card({ key: 'NEX2-2' }), card({ key: null as unknown as string })]);
        assert.equal(store.replaceJira(SCOPE, broken), false);

        assert.deepEqual(store.issuesOf(SCOPE).map((issue) => issue.key), ['NEX2-1']);
        assert.equal(store.lastSuccessAt(SCOPE), before);
    });
});

test('writing to a closed database never throws at the caller', () => {
    const dir = mkdtempSync(join(tmpdir(), 'facts-'));
    const path = join(dir, 'facts.sqlite');
    const store = FactStore.open(path);
    assert.ok(store);
    store.close();

    assert.equal(store.replaceJira(SCOPE, jiraSnapshot([card({ key: 'NEX2-1' })])), false);
    assert.equal(store.upsertBuilds('job/a', [build(1, 'SUCCESS', 'sha1')]), false);
    assert.equal(store.lastSuccessAt(SCOPE), null);
    rmSync(dir, { recursive: true, force: true });
});

test('a gitlab scope keeps its mr rows and approval snapshot', () => {
    withStore((store) => {
        const scope = 'gitlab:group/repo@nexus/dev/7.10.x';
        const replaced = store.replaceGitLab(scope, {
            project: 'group/repo',
            mrs: [
                {
                    project: 'group/repo',
                    iid: 3786,
                    state: 'opened',
                    title: 'NEX2-1 fix',
                    sourceBranch: 'bug-1',
                    targetBranch: 'nexus/dev/7.10.x',
                    authorId: 7,
                    authorName: 'Alice',
                    createdAt: 1_700_000_000_000,
                    updatedAt: 1_700_000_100_000,
                    mergedAt: null,
                    mergeCommitSha: null,
                    draft: false,
                    hasConflicts: true,
                    blockingDiscussionsResolved: false,
                    reviewerIds: [42],
                    webUrl: 'https://gitlab/!3786',
                    approved: true,
                    approvalsLeft: 0,
                },
            ],
            approvals: [
                { project: 'group/repo', iid: 3786, userId: 42, userName: 'Bob', approvedAt: 1_700_000_200_000 },
            ],
        });

        assert.equal(replaced, true);
        const [row] = store.mrsOf(scope);
        assert.equal(row.iid, 3786);
        assert.equal(row.hasConflicts, true);
        assert.equal(row.blockingDiscussionsResolved, false);
        assert.deepEqual(row.reviewerIds, [42]);
        assert.equal(row.approved, true);
        assert.equal(row.approvalsLeft, 0);
        assert.equal(row.createdAt, 1_700_000_000_000);

        const approvals = store.approvalsOf('group/repo', 3786);
        assert.equal(approvals.length, 1);
        assert.equal(approvals[0].approvedAt, 1_700_000_200_000);
    });
});

test('an older database is migrated, and a .bak is left behind', () => {
    const dir = mkdtempSync(join(tmpdir(), 'facts-'));
    const path = join(dir, 'facts.sqlite');
    const sqlite = loadSqlite();
    assert.ok(sqlite);

    // 造一个「v0 但有内容」的库：迁移前必须能备份
    const raw = new sqlite.DatabaseSync(path);
    raw.exec('CREATE TABLE old_marker(x INTEGER)');
    raw.exec('PRAGMA user_version = 0');
    raw.close();

    const result = FactStore.openWithStatus(path);
    assert.equal(result.status, 'ok');
    assert.ok(result.store);
    assert.equal(result.store.schemaVersion(), 1);
    assert.deepEqual(result.store.columnsOf('old_marker').map((column) => column.name), ['x']);
    assert.equal(existsSync(`${path}.bak`), true);

    result.store.close();
    rmSync(dir, { recursive: true, force: true });
});

test('a corrupt database is renamed and rebuilt, and the board is told', () => {
    const dir = mkdtempSync(join(tmpdir(), 'facts-'));
    const path = join(dir, 'facts.sqlite');
    writeFileSync(path, 'this is definitely not a sqlite database');

    const result = FactStore.openWithStatus(path);
    assert.equal(result.status, 'recovered');
    assert.match(result.message ?? '', /历史已重置/);
    assert.ok(result.store);
    assert.ok(
        readdirSync(dir).some((name) => name.includes('.corrupt-')),
        'the broken file must be kept, not deleted'
    );

    // 重建后的库能正常干活
    assert.equal(result.store.replaceJira(SCOPE, jiraSnapshot([card({ key: 'NEX2-1' })])), true);
    assert.deepEqual(result.store.issuesOf(SCOPE).map((issue) => issue.key), ['NEX2-1']);

    result.store.close();
    rmSync(dir, { recursive: true, force: true });
});

test('a database from a newer version is opened read-only and never migrated down', () => {
    const dir = mkdtempSync(join(tmpdir(), 'facts-'));
    const path = join(dir, 'facts.sqlite');
    const sqlite = loadSqlite();
    assert.ok(sqlite);

    const raw = new sqlite.DatabaseSync(path);
    raw.exec('PRAGMA user_version = 99');
    raw.close();

    const result = FactStore.openWithStatus(path);
    assert.equal(result.status, 'readonly');
    assert.match(result.message ?? '', /更新版本/);
    assert.ok(result.store);
    assert.equal(result.store.schemaVersion(), 99, 'the version must not be downgraded');
    assert.equal(result.store.replaceJira(SCOPE, jiraSnapshot([card({ key: 'NEX2-1' })])), false);

    result.store.close();
    rmSync(dir, { recursive: true, force: true });
});

test('derived state is never persisted', () => {
    withStore((store) => {
        const columns = store.columnsOf('issue').map((column) => column.name);
        for (const derived of ['stage', 'buildFailed', 'buildChannel', 'mergedDaysAgo', 'evidence', 'revision']) {
            assert.equal(columns.includes(derived), false, `${derived} must not be a column`);
        }
        assert.equal(store.columnsOf('build').map((column) => column.name).includes('sha'), true);
    });
});
