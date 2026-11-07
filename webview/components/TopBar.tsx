import type { BoardStatePayload } from '../../src/models/Board';
import type { BoardModel } from '../useBoardModel';

export function TopBar({ model }: { model: BoardModel }) {
    const state: BoardStatePayload | null = model.state;
    const stamp = describeStamp(state);

    return (
        <header class="topbar">
            <div class="brand">
                Jira Board
                <small>{state?.sprintName ?? '未连接'}</small>
            </div>

            {state ? <ProjectChips state={state} model={model} /> : null}

            {state ? (
                <label class="toggle">
                    <input
                        type="checkbox"
                        checked={state.scope.onlyMine}
                        onChange={(event) => {
                            const target = event.currentTarget as HTMLInputElement;
                            model.setScope(state.scope.projects, target.checked);
                        }}
                    />
                    只看我的
                </label>
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

function ProjectChips({ state, model }: { state: BoardStatePayload; model: BoardModel }) {
    const selected = state.scope.projects;
    const options = state.projectOptions;
    const allOn = options.length > 0 && options.every((project) => selected.includes(project));

    const toggle = (project: string) => {
        const next = selected.includes(project)
            ? selected.filter((item) => item !== project)
            : [...selected, project];
        model.setScope(next, state.scope.onlyMine);
    };

    return (
        <div class="chips">
            <button
                class="chip-btn"
                aria-pressed={allOn}
                onClick={() => model.setScope(allOn ? [] : [...options], state.scope.onlyMine)}
            >
                全部
            </button>
            {options.map((project) => (
                <button
                    key={project}
                    class="chip-btn"
                    aria-pressed={selected.includes(project)}
                    onClick={() => toggle(project)}
                >
                    {project}
                </button>
            ))}
        </div>
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
