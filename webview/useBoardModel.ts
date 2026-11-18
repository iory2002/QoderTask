import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { normalizeStageFilters, toggleStageFilter } from '../src/board/stageFilter';
import type { BoardStatePayload, CardDensity, ExtensionResponse, StageFilterId } from '../src/models/Board';
import { onMessage, post } from './api';

export interface BoardModel {
    state: BoardStatePayload | null;
    error: string | null;
    refresh(force?: boolean): void;
    setScope(projects: string[], onlyMine: boolean): void;
    setDensity(density: CardDensity): void;
    /** 勾 / 取消一列：以本地最新名单为准增删，连点不会互相覆盖 */
    toggleColumn(columnId: string): void;
    /** 直接定下阶段勾选（全选 / 清空） */
    setStages(stages: StageFilterId[]): void;
    /** 勾 / 取消一个阶段徽章 */
    toggleStage(id: StageFilterId): void;
}

/** 四个纯视图开关：改它们不碰数据，也不该等宿主往返 */
interface ViewState {
    onlyMine: boolean;
    hiddenColumnIds: string[];
    density: CardDensity;
    stages: StageFilterId[];
}

function viewOf(payload: BoardStatePayload): ViewState {
    return {
        onlyMine: payload.scope.onlyMine,
        hiddenColumnIds: payload.hiddenColumnIds,
        density: payload.view.density,
        stages: normalizeStageFilters(payload.view.stages),
    };
}

function sameHidden(left: string[] | undefined, right: string[]): boolean {
    return left !== undefined && left.length === right.length && left.every((id, index) => id === right[index]);
}

/** 阶段勾选已经按菜单顺序归一，逐项比就行 */
function sameStages(left: StageFilterId[] | undefined, right: StageFilterId[]): boolean {
    return left !== undefined && left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * 单一数据源 + 本地视图覆盖。
 *
 * 数据（列与卡片）只来自 board:state；「只看我的 / 显示列 / 交付阶段 / 详细·精简」是纯视图：
 * 点击当场改本地状态立刻重绘，同时把意图发给宿主保存。宿主帧只有在「它那一侧的值
 * 变了」（手改 settings.json、另一个窗口）时才覆盖本地；值没变就说明这帧不是在说
 * 视图，本地改动一律保留。所以勾列、切过滤器都不会整板重发，也不会闪一下。
 *
 * 视图状态额外留一份同步副本（viewRef）：连点两下时第二次读到的是第一次的结果，
 * 不必等 Preact 重绘，也不会被上一次回帧的旧集合覆盖。
 *
 * 看板只读：写通道只有「指派给我」一条（card:assignToMe），改状态仍去 Jira。
 */
export function useBoardModel(): BoardModel {
    const [state, setState] = useState<BoardStatePayload | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [view, setView] = useState<ViewState | null>(null);
    /** 与 view 同步更新的镜像：给事件处理器读「最新值」用 */
    const viewRef = useRef<ViewState | null>(null);
    /** 上一次宿主给的视图值：用来分辨「值真的变了」与「同一份旧数据」 */
    const hostView = useRef<ViewState | null>(null);

    useEffect(() => {
        const off = onMessage((message: ExtensionResponse) => {
            if (message.type === 'board:state') {
                const payload = message.payload;
                const incoming = viewOf(payload);
                const previous = hostView.current;
                hostView.current = incoming;

                // 首帧全盘采纳；之后只采纳宿主那边确实变了的字段
                const adopted: Partial<ViewState> = {};
                if (previous === null || previous.onlyMine !== incoming.onlyMine) {
                    adopted.onlyMine = incoming.onlyMine;
                }
                if (previous === null || previous.density !== incoming.density) {
                    adopted.density = incoming.density;
                }
                if (previous === null || !sameHidden(previous.hiddenColumnIds, incoming.hiddenColumnIds)) {
                    adopted.hiddenColumnIds = incoming.hiddenColumnIds;
                }
                if (previous === null || !sameStages(previous.stages, incoming.stages)) {
                    adopted.stages = incoming.stages;
                }
                if (Object.keys(adopted).length > 0) {
                    const next = viewRef.current ? { ...viewRef.current, ...adopted } : incoming;
                    viewRef.current = next;
                    setView(next);
                }

                setState((current) => (current && current.revision === payload.revision ? current : payload));
                setError(null);
            } else if (message.type === 'board:error') {
                setError(message.payload.message);
            }
        });
        post({ type: 'board:ready' });
        return off;
    }, []);

    /** 交给界面的状态：数据来自宿主，视图开关以本地为准 */
    const merged = useMemo<BoardStatePayload | null>(() => {
        if (!state) {
            return null;
        }
        if (!view) {
            return state;
        }
        return {
            ...state,
            scope: { ...state.scope, onlyMine: view.onlyMine },
            hiddenColumnIds: view.hiddenColumnIds,
            view: { ...state.view, density: view.density, stages: view.stages },
        };
    }, [state, view]);

    return useMemo(() => {
        /** 先写镜像再 setState：同一 tick 里的后续点击能立刻读到 */
        const applyView = (patch: Partial<ViewState>): void => {
            const next = viewRef.current ? { ...viewRef.current, ...patch } : null;
            viewRef.current = next;
            setView(next);
        };
        const publishVisibleColumns = (hiddenColumnIds: string[]): void => {
            const columns = merged?.columns ?? [];
            post({
                type: 'board:setVisibleColumns',
                payload: {
                    visibleColumnIds: columns
                        .filter((column) => !hiddenColumnIds.includes(column.id))
                        .map((column) => column.id),
                },
            });
        };

        return {
            state: merged,
            error,
            refresh: (force?: boolean) => post({ type: 'board:refresh', payload: { force } }),
            setScope: (projects: string[], onlyMine: boolean) => {
                applyView({ onlyMine });
                post({ type: 'board:setScope', payload: { projects, onlyMine } });
            },
            setDensity: (density: CardDensity) => {
                applyView({ density });
                post({ type: 'board:setDensity', payload: { density } });
            },
            setStages: (stages: StageFilterId[]) => {
                const next = normalizeStageFilters(stages);
                applyView({ stages: next });
                post({ type: 'board:setStages', payload: { stages: next } });
            },
            toggleStage: (id: StageFilterId) => {
                const current = viewRef.current;
                if (!current) {
                    return;
                }
                // 以本地最新名单为准：连点两下不会用上一次回帧的旧集合
                const next = toggleStageFilter(current.stages, id);
                applyView({ stages: next });
                post({ type: 'board:setStages', payload: { stages: next } });
            },
            toggleColumn: (columnId: string) => {
                const current = viewRef.current;
                if (!current) {
                    return;
                }
                const hidden = new Set(current.hiddenColumnIds);
                if (hidden.has(columnId)) {
                    hidden.delete(columnId);
                } else {
                    hidden.add(columnId);
                }
                // 按看板列顺序落盘，避免每点一次都改一次顺序
                const hiddenColumnIds = (merged?.columns ?? [])
                    .filter((column) => hidden.has(column.id))
                    .map((column) => column.id);
                applyView({ hiddenColumnIds });
                publishVisibleColumns(hiddenColumnIds);
            },
        };
    }, [merged, error]);
}
