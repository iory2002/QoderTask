import type { BoardStatePayload } from '../../src/models/Board';
import type { BoardModel } from '../useBoardModel';

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
