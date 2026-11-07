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
            <div class="spacer" />
            <span class={stamp.stale ? 'stamp stale' : 'stamp'}>{stamp.text}</span>
            <button class="btn" onClick={() => model.refresh(true)} title="立即重新拉取">
                刷新
            </button>
        </header>
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
    const shown = state.cards.length;
    if (state.freshness.stale) {
        return { text: `数据可能过期 · ${time} · ${shown} 张`, stale: true };
    }
    return { text: `同步于 ${time} · ${shown} 张`, stale: false };
}
