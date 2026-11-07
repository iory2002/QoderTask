import type { BoardColumn, ColumnDropRule } from '../models/Board';

export interface SimpleTransition {
    id: string;
    name: string;
    toStatusId: string;
}

export interface DropRuleInput {
    columns: BoardColumn[];
    /** 卡片当前状态；列外状态也能算（currentIndex = -1） */
    currentStatusId: string;
    transitions: SimpleTransition[];
}

/**
 * 逐列判定能不能放。
 *
 * 关键点：**不能按列相邻性推**。同样的 `In Progress`，Story 只能到 In Code Review，
 * Bug/Task 直达 In Test，Task 还能一步到 Done —— 合法目标只由该 issue 自己的 transitions 决定。
 * 单向：往回拖一律拒绝，回退去 Jira 网页。
 */
export function computeDropRules({ columns, currentStatusId, transitions }: DropRuleInput): ColumnDropRule[] {
    const currentIndex = columns.findIndex((column) => column.statusIds.includes(currentStatusId));

    return columns.map((column, index) => {
        if (index === currentIndex) {
            return { columnId: column.id, legal: false, reason: '卡片已经在这一列' };
        }
        if (currentIndex >= 0 && index < currentIndex) {
            return {
                columnId: column.id,
                legal: false,
                reason: '看板不支持回退：需要回退请到 Jira 网页操作',
            };
        }

        const match = transitions.find((transition) => column.statusIds.includes(transition.toStatusId));
        if (!match) {
            const reachable = [
                ...new Set(
                    transitions
                        .map(
                            (transition) =>
                                columns.find((candidate) => candidate.statusIds.includes(transition.toStatusId))?.name
                        )
                        .filter((name): name is string => Boolean(name))
                ),
            ];
            return {
                columnId: column.id,
                legal: false,
                reason:
                    reachable.length > 0
                        ? `没有直达「${column.name}」的动作；当前可去：${reachable.join(' / ')}`
                        : `没有直达「${column.name}」的动作`,
            };
        }

        return {
            columnId: column.id,
            legal: true,
            transitionId: match.id,
            transitionName: match.name,
        };
    });
}
