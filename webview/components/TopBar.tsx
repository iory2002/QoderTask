import { ALL_STAGE_FILTERS, STAGE_FILTERS, isAllStages } from '../../src/board/stageFilter';
import type { BoardStatePayload } from '../../src/models/Board';
import type { BoardModel } from '../useBoardModel';
import { ViewMenu } from './ViewMenu';

export function TopBar({ model }: { model: BoardModel }) {
    const state: BoardStatePayload | null = model.state;
    const stamp = describeStamp(state);

    return (
        <header class="topbar">
            <div class="brand">
                Jira Board
                <span class="sprint-name">{state?.sprintName ?? '未连接'}</span>
            </div>

            {state ? <ProjectScope state={state} /> : null}

            {state ? <ViewMenu state={state} model={model} /> : null}

            {state && state.hiddenColumnIds.length > 0 ? (
                <span class="stamp" title="这些列被 pcBoard.hiddenColumns 隐藏；卡片仍然全量拉取，角标与计数不受影响">
                    已隐藏 {state.hiddenColumnIds.length} 列
                </span>
            ) : null}

            {state && state.capabilities.gitlab && !isAllStages(state.view.stages) ? (
                <StageFilterChip state={state} model={model} />
            ) : null}

            <div class="spacer" />
            {state && state.unmappedCount > 0 ? (
                <span class="stamp" title="这些 issue 的状态不属于任何 board 列，因此不出卡片">
                    列外状态 {state.unmappedCount} 条
                </span>
            ) : null}
            <span class={stamp.stale ? 'stamp stale' : 'stamp'}>{stamp.text}</span>
            <button class="btn" onClick={() => model.refresh(true)} title="立即重新拉取">
                刷新
            </button>
        </header>
    );
}

/**
 * 阶段筛选生效时的顶栏提示：直接列出勾中的徽章，不用打开菜单就知道看板被筛过。
 * 最多列 3 个，剩下的收成 +N（悬停看全名单）；点 × 一键还原成全部阶段。
 */
function StageFilterChip({ state, model }: { state: BoardStatePayload; model: BoardModel }) {
    const selected = new Set(state.view.stages);
    const chosen = STAGE_FILTERS.filter((option) => selected.has(option.id));
    const shown = chosen.slice(0, 3);
    const rest = chosen.slice(3);
    return (
        <span class="filter-chip" title="交付阶段筛选正在生效；卡片数据与角标不受影响">
            <span class="filter-chip-label">阶段</span>
            {chosen.length === 0 ? (
                <span class="filter-chip-none">一个都没勾</span>
            ) : (
                shown.map((option) => (
                    <span class={`stage ${option.cls}`} key={option.id} title={option.hint}>
                        {option.label}
                    </span>
                ))
            )}
            {rest.length > 0 ? (
                <span class="filter-chip-more" title={rest.map((option) => option.label).join('、')}>
                    +{rest.length}
                </span>
            ) : null}
            <button
                class="filter-chip-clear"
                title="显示全部阶段"
                aria-label="清除阶段筛选"
                onClick={() => model.setStages(ALL_STAGE_FILTERS)}
            >
                ×
            </button>
        </span>
    );
}

/** 看板范围来自设置，不在标题栏里提供交互：只把当前生效的项目显示出来 */
function ProjectScope({ state }: { state: BoardStatePayload }) {
    const projects = state.scope.projects;
    const text = projects.length === 0 ? '未选项目' : projects.join(' · ');
    return (
        <span class="project-label" title="看板范围来自设置 pcBoard.projects">
            {text}
        </span>
    );
}

function describeStamp(state: BoardStatePayload | null): { text: string; stale: boolean } {
    if (!state) {
        return { text: '正在连接…', stale: false };
    }
    if (state.freshness.lastSuccessAt === null) {
        return { text: state.freshness.stale ? '数据可能过期' : '尚未取到数据', stale: state.freshness.stale };
    }
    const time = new Date(state.freshness.lastSuccessAt).toLocaleTimeString();
    const shown = state.cards.filter((card) => state.scope.projects.includes(card.project)).length;
    if (state.freshness.stale) {
        return { text: `数据可能过期 · ${time} · ${shown} 张`, stale: true };
    }
    return { text: `同步于 ${time} · ${shown} 张`, stale: false };
}
