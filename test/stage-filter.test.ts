import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { cardsInScope, inScope } from '../src/board/cardScope';
import {
    ALL_STAGE_FILTERS,
    cardMatchesStages,
    countStageFilters,
    isAllStages,
    normalizeStageFilters,
    stageBadgeText,
    stageFiltersOf,
    toggleStageFilter,
} from '../src/board/stageFilter';
import type { BoardCard, BuildFact } from '../src/models/Board';

function card(overrides: Partial<BoardCard> & { key: string }): BoardCard {
    return {
        project: 'NEX2',
        summary: '',
        issueType: 'Story',
        priority: null,
        statusId: '1',
        statusName: 'Open',
        columnName: 'To Do',
        epicKey: null,
        epicLabel: null,
        rank: '',
        assignee: null,
        isMine: true,
        pinned: false,
        isSubtask: false,
        commentCount: 0,
        updatedAtEpoch: null,
        stage: null,
        buildFailed: false,
        buildChannel: 'none',
        mrs: [],
        evidence: [],
        url: '',
        ...overrides,
    };
}

const BUILD: BuildFact = {
    number: 42,
    result: 'FAILURE',
    timestamp: 1_700_000_000_000,
    branch: 'nexus/dev/7.10.x',
    url: 'https://jenkins/job/42/',
    sha: 'abc123',
};

test('a card with no stage tracking has no badge, and lands in the nobadge bucket', () => {
    assert.deepEqual(stageFiltersOf(card({ key: 'NEX2-1', stage: null })), ['nobadge']);
});

test('a Task without an MR shows no badge, so it is nobadge rather than 未提交', () => {
    assert.deepEqual(stageFiltersOf(card({ key: 'NEX2-2', stage: 'none', codeWork: false })), ['nobadge']);
    // 写代码的类型（Story / Bug）没有 MR 时仍然报「未提交」
    assert.deepEqual(stageFiltersOf(card({ key: 'NEX2-3', stage: 'none' })), ['none']);
});

test('a failed build adds a second badge on top of the stage badge', () => {
    assert.deepEqual(
        stageFiltersOf(card({ key: 'NEX2-4', stage: 'merged', buildFailed: true, build: BUILD })),
        ['merged', 'failed']
    );
});

test('buildFailed without a build fact renders no failure badge, so it is not counted', () => {
    assert.deepEqual(stageFiltersOf(card({ key: 'NEX2-5', stage: 'merged', buildFailed: true })), ['merged']);
});

test('a stored value that is not an array falls back to all stages, never an empty board', () => {
    assert.deepEqual(normalizeStageFilters(undefined), ALL_STAGE_FILTERS);
    assert.deepEqual(normalizeStageFilters(null), ALL_STAGE_FILTERS);
    assert.deepEqual(normalizeStageFilters('built'), ALL_STAGE_FILTERS);
});

test('unknown ids are dropped and the result keeps the menu order', () => {
    assert.deepEqual(normalizeStageFilters(['built', 'nonsense', 'mr', 'built']), ['mr', 'built']);
});

test('an explicit empty selection stays empty: that is the user unchecking everything', () => {
    assert.deepEqual(normalizeStageFilters([]), []);
});

test('toggling adds and removes while keeping the menu order', () => {
    assert.deepEqual(toggleStageFilter(['mr'], 'built'), ['mr', 'built']);
    assert.deepEqual(toggleStageFilter(['mr', 'built'], 'mr'), ['built']);
    assert.deepEqual(toggleStageFilter([], 'failed'), ['failed']);
});

test('all stages selected means no filtering at all', () => {
    assert.equal(isAllStages(ALL_STAGE_FILTERS), true);
    assert.equal(isAllStages(normalizeStageFilters(undefined)), true);
    assert.equal(isAllStages(['built']), false);
    assert.equal(isAllStages([]), false);
});

test('a card matches when any of its badges is selected', () => {
    const failed = card({ key: 'NEX2-6', stage: 'merged', buildFailed: true, build: BUILD });
    assert.equal(cardMatchesStages(failed, ['failed']), true);
    assert.equal(cardMatchesStages(failed, ['merged']), true);
    assert.equal(cardMatchesStages(failed, ['built']), false);
});

test('with every stage selected every card passes, including the badge-less ones', () => {
    assert.equal(cardMatchesStages(card({ key: 'NEX2-7', stage: null }), ALL_STAGE_FILTERS), true);
});

test('an empty selection hides everything, the board shows its reset empty state', () => {
    assert.equal(cardMatchesStages(card({ key: 'NEX2-8', stage: 'built' }), []), false);
});

test('counts include the failure badge separately from its stage', () => {
    const counts = countStageFilters([
        card({ key: 'NEX2-9', stage: 'built' }),
        card({ key: 'NEX2-10', stage: 'merged', buildFailed: true, build: BUILD }),
        card({ key: 'NEX2-11', stage: null }),
    ]);
    assert.equal(counts.built, 1);
    assert.equal(counts.merged, 1);
    assert.equal(counts.failed, 1);
    assert.equal(counts.nobadge, 1);
    assert.equal(counts.none, 0);
});

test('compact cards use the short badge name, merge-only drops the 待构建 suffix', () => {
    const merged = card({ key: 'NEX2-12', stage: 'merged', buildChannel: 'full' });
    assert.equal(stageBadgeText(merged, false), '已合入待构建');
    assert.equal(stageBadgeText(merged, true), '已合入');
    assert.equal(stageBadgeText(card({ key: 'NEX2-13', stage: 'merged', buildChannel: 'merge-only' }), false), '已合入');
    assert.equal(stageBadgeText(card({ key: 'NEX2-14', stage: 'approved' }), true), '已审批');
});

test('a rework card with no new MR shows 返工中 instead of 未提交', () => {
    const rework = card({ key: 'NEX2-18', stage: 'none', rework: true });
    assert.deepEqual(stageFiltersOf(rework), ['rework']);
    assert.equal(stageBadgeText(rework, false), '返工中');
    assert.equal(stageBadgeText(rework, true), '返工');
    // 返工中被退回的卡不是「未提交」，勾「未提交」不应把它带出来
    assert.equal(cardMatchesStages(rework, ['none']), false);
    assert.equal(cardMatchesStages(rework, ['rework']), true);
});

test('a rework round with a new MR keeps both the stage and the rework bucket', () => {
    assert.deepEqual(stageFiltersOf(card({ key: 'NEX2-19', stage: 'mr', rework: true })), ['mr', 'rework']);
});

test('scope keeps pinned cards visible even when only-mine is on', () => {
    const scope = { projects: ['NEX2'], onlyMine: true };
    assert.equal(inScope(card({ key: 'NEX2-15', isMine: false, pinned: true }), scope), true);
    assert.equal(inScope(card({ key: 'NEX2-16', isMine: false }), scope), false);
    assert.equal(inScope(card({ key: 'OTHER-1', project: 'OTHER' }), scope), false);
});

test('the menu counts and the board see the same scoped cards', () => {
    const scope = { projects: ['NEX2'], onlyMine: false };
    const cards = [card({ key: 'NEX2-17' }), card({ key: 'OTHER-2', project: 'OTHER' })];
    assert.deepEqual(cardsInScope(cards, scope).map((item) => item.key), ['NEX2-17']);
});