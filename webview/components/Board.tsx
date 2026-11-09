import type { BoardStatePayload } from '../../src/models/Board';
import { post } from '../api';
import { Card } from './Card';

export interface BoardProps {
    state: BoardStatePayload;
    onRetry: () => void;
    onOpenDetail: (key: string) => void;
}

/**
 * 只读看板。
 *
 * 这里刻意不做拖拽：Jira 的 transition 大多带必填字段（screen），
 * 看板里填不了，硬做只会让用户在半路的表单里卡住。
 * 改状态一律走「在 Jira 中打开」。
 */
export function Board({ state, onRetry, onOpenDetail }: BoardProps) {
    if (state.columns.length === 0) {
        return (
            <div class="placeholder error">
                <h3>读不到看板列</h3>
                <span>{state.freshness.error ?? 'Jira 没有返回列定义'}</span>
                <button class="btn" onClick={onRetry}>
                    重试
                </button>
            </div>
        );
    }

    const openJira = (key: string) => post({ type: 'card:openJira', payload: { key } });
    const openBuild = (url: string) => post({ type: 'board:openExternal', payload: { url } });
    // 纯视图过滤：数据是全量拉回来的，切「只看我的」/项目 chip 都不发请求
    const visible = state.cards.filter(
        (card) =>
            state.scope.projects.includes(card.project) &&
            (!state.scope.onlyMine || card.isMine || card.pinned)
    );
    const showAvatar = !state.scope.onlyMine;

    return (
        <main class="board">
            {state.columns.map((column) => {
                const cards = visible.filter((card) => column.statusIds.includes(card.statusId));
                const isDone = column.name.toLowerCase() === 'done';

                return (
                    <section class={isDone ? 'col done' : 'col'} key={column.id} data-column={column.id}>
                        <h2>
                            {column.name}
                            <span>{cards.length}</span>
                        </h2>
                        {cards.length === 0 ? <div class="col-empty">空</div> : null}
                        {cards.map((card) => (
                            <Card
                                key={card.key}
                                card={card}
                                showAvatar={showAvatar}
                                onOpenJira={openJira}
                                onOpenDetail={onOpenDetail}
                                onOpenBuild={openBuild}
                            />
                        ))}
                    </section>
                );
            })}
        </main>
    );
}
