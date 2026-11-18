import type { BoardCard, Stage, StageFilterId } from '../models/Board';

/**
 * 阶段徽章的文案与配色。
 *
 * 卡片（Card.tsx）与「交付阶段」菜单共用这一份：两处各写一套的话，
 * 菜单里勾的名字迟早和卡片上显示的对不上。
 * 纯函数、无 vscode 依赖，宿主与 WebView 都能 import。
 */
export const STAGE_BADGES: Record<Stage, { text: string; short: string; cls: string }> = {
    none: { text: '未提交', short: '未提交', cls: 's-none' },
    mr: { text: 'MR 待审', short: '待审', cls: 's-mr' },
    approved: { text: '已 Approve 待合入', short: '已审批', cls: 's-appr' },
    merged: { text: '已合入待构建', short: '已合入', cls: 's-merged' },
    built: { text: '已构建', short: '已构建', cls: 's-built' },
    unknown: { text: '无法判定', short: '未知', cls: 's-unk' },
};

/**
 * 返工中：Jira 已退回开发、本轮还没有新 MR。
 * 卡片用它替代「未提交」，与阶段徽章同一套渲染。
 */
export const REWORK_BADGE = { text: '返工中', short: '返工', cls: 's-rework' };

export interface StageFilterOption {
    id: StageFilterId;
    label: string;
    /** 与卡片徽章同一套配色，菜单里一眼能对上 */
    cls: string;
    hint: string;
}

/** 菜单顺序 = 交付推进顺序；构建失败与无徽章是两种特殊情况，排在最后 */
export const STAGE_FILTERS: readonly StageFilterOption[] = [
    { id: 'none', label: STAGE_BADGES.none.text, cls: STAGE_BADGES.none.cls, hint: '还没有关联到合入目标分支的 MR' },
    { id: 'mr', label: STAGE_BADGES.mr.text, cls: STAGE_BADGES.mr.cls, hint: 'MR 开着，还没批准' },
    {
        id: 'approved',
        label: STAGE_BADGES.approved.text,
        cls: STAGE_BADGES.approved.cls,
        hint: '已批准，等着合入目标分支',
    },
    {
        id: 'merged',
        label: STAGE_BADGES.merged.text,
        cls: STAGE_BADGES.merged.cls,
        hint: '已合入，还没被成功构建包含',
    },
    { id: 'built', label: STAGE_BADGES.built.text, cls: STAGE_BADGES.built.cls, hint: '最新成功构建的代码树里有它' },
    {
        id: 'unknown',
        label: STAGE_BADGES.unknown.text,
        cls: STAGE_BADGES.unknown.cls,
        hint: 'GitLab / Jenkins 取数失败，判不出来（不是「未提交」）',
    },
    {
        id: 'rework',
        label: REWORK_BADGE.text,
        cls: REWORK_BADGE.cls,
        hint: 'Jira 已退回开发，上一轮的合入 / 构建不计入本轮；本轮还没有新的 MR',
    },
    {
        id: 'failed',
        label: '构建失败',
        cls: 's-fail',
        hint: '从未被成功构建包含过，而最新已完成构建确实包含它并失败了',
    },
    {
        id: 'nobadge',
        label: '无徽章',
        cls: 's-nobadge',
        hint: '项目没配 repo 条目，或 Task / Sub-task 没有 MR —— 卡片上本来就不出徽章',
    },
];

/** 全选 = 不过滤。顺序固定，落盘与比较都按它来 */
export const ALL_STAGE_FILTERS: StageFilterId[] = STAGE_FILTERS.map((option) => option.id);

/**
 * 存进 memento / 从 WebView 收到的值 → 合法勾选集合。
 *
 * 不是数组（没存过、值被改坏）一律按全选处理：不能因为一个坏值把整块看板变空。
 * 显式的空数组保留为空 —— 那是用户「一个都不勾」的结果，由界面给出空态与还原入口。
 * 结果按菜单顺序排列，避免每点一次都改一次顺序。
 */
export function normalizeStageFilters(value: unknown): StageFilterId[] {
    if (!Array.isArray(value)) {
        return [...ALL_STAGE_FILTERS];
    }
    const known = new Set<string>(ALL_STAGE_FILTERS);
    const wanted = new Set(value.filter((id): id is StageFilterId => typeof id === 'string' && known.has(id)));
    return ALL_STAGE_FILTERS.filter((id) => wanted.has(id));
}

/** 勾 / 取消一项，结果仍按菜单顺序 */
export function toggleStageFilter(selected: StageFilterId[], id: StageFilterId): StageFilterId[] {
    const wanted = new Set(selected);
    if (wanted.has(id)) {
        wanted.delete(id);
    } else {
        wanted.add(id);
    }
    return ALL_STAGE_FILTERS.filter((item) => wanted.has(item));
}

/** 全选时不做任何过滤，连徽章派生都省了 */
export function isAllStages(selected: StageFilterId[]): boolean {
    return ALL_STAGE_FILTERS.every((id) => selected.includes(id));
}

/**
 * 这张卡实际会渲染出哪些徽章。
 *
 * 判定必须与 Card.tsx 的 StageBadges 完全一致，否则菜单里勾了某项、
 * 卡片却因为没有那个徽章而消失（或反过来）。
 */
export function stageFiltersOf(card: BoardCard): StageFilterId[] {
    // 项目不追踪阶段：整块徽章都不渲染
    if (card.stage === null) {
        return ['nobadge'];
    }
    // 返工中：本轮从零起算，显示「返工中」而不是「未提交」
    if (card.rework && card.stage === 'none') {
        return ['rework'];
    }
    // Task / Sub-task 没有 MR：整块徽章都不渲染
    if (card.stage === 'none' && card.codeWork === false) {
        return ['nobadge'];
    }
    const ids: StageFilterId[] = [card.stage];
    if (card.rework) {
        ids.push('rework');
    }
    if (card.buildFailed && card.build) {
        ids.push('failed');
    }
    return ids;
}

/** 任意一个勾选的徽章命中就显示：一张卡可能同时有阶段徽章与构建失败徽章 */
export function cardMatchesStages(card: BoardCard, selected: StageFilterId[]): boolean {
    if (isAllStages(selected)) {
        return true;
    }
    const wanted = new Set(selected);
    return stageFiltersOf(card).some((id) => wanted.has(id));
}

/** 每个选项当前命中多少张卡（构建失败与它的阶段徽章会各计一次） */
export function countStageFilters(cards: BoardCard[]): Record<StageFilterId, number> {
    const counts = Object.fromEntries(ALL_STAGE_FILTERS.map((id) => [id, 0])) as Record<StageFilterId, number>;
    for (const card of cards) {
        for (const id of stageFiltersOf(card)) {
            counts[id] += 1;
        }
    }
    return counts;
}

/**
 * 卡片上的徽章文案。
 * 精简模式用短名（一行里还要放构建失败徽章）；
 * merge-only 通道没有构建这一跳，「已合入待构建」压成「已合入」。
 */
export function stageBadgeText(card: BoardCard, compact: boolean): string {
    if (card.rework && card.stage === 'none') {
        return compact ? REWORK_BADGE.short : REWORK_BADGE.text;
    }
    const badge = STAGE_BADGES[card.stage ?? 'unknown'] ?? STAGE_BADGES.unknown;
    if (compact) {
        return badge.short;
    }
    return card.stage === 'merged' && card.buildChannel === 'merge-only' ? '已合入' : badge.text;
}