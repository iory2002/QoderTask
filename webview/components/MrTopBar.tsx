import type { MrBoardPayload } from '../../src/models/MrBoard';
import type { MrBoardModel } from '../useMrBoardModel';
import { shortRepo } from './MrCard';

export function MrTopBar({ model }: { model: MrBoardModel }) {
    const state: MrBoardPayload | null = model.state;
    const stamp = describeStamp(state);

    return (
        <header class="topbar">
            <div class="brand">GitLab Board</div>

            {state ? (
                <div class="mr-scope">
                    {state.scope.map((entry) => (
                        <span
                            class="scope-chip"
                            key={`${entry.gitlabProject}@${entry.targetBranch}`}
                            title={`${entry.gitlabProject} @ ${entry.targetBranch}`}
                        >
                            {shortRepo(entry.gitlabProject)} @ {entry.targetBranch}
                        </span>
                    ))}
                </div>
            ) : null}

            <div class="spacer" />

            {state && state.closedCount > 0 ? (
                <span class="stamp" title="已关闭且未合入的 MR，不进列">
                    另有 {state.closedCount} 个已关闭
                </span>
            ) : null}
            <span class={stamp.stale ? 'stamp stale' : 'stamp'}>{stamp.text}</span>
            <button class="btn" onClick={() => model.refresh(true)} title="立即重新拉取">
                刷新
            </button>
        </header>
    );
}

function describeStamp(state: MrBoardPayload | null): { text: string; stale: boolean } {
    if (!state) {
        return { text: '正在连接…', stale: false };
    }
    if (state.freshness.lastSuccessAt === null) {
        return { text: state.freshness.stale ? '数据可能过期' : '尚未取到数据', stale: state.freshness.stale };
    }
    const time = new Date(state.freshness.lastSuccessAt).toLocaleTimeString();
    const total = state.reviewQueue.length + state.myMrs.length;
    if (state.freshness.stale) {
        return { text: `数据可能过期 · ${time} · ${total} 张`, stale: true };
    }
    return { text: `同步于 ${time} · ${total} 张`, stale: false };
}
