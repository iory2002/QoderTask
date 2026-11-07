import type { BoardStatePayload } from '../../src/models/Board';
import { post } from '../api';
import { Card } from './Card';

export function Board({ state, onRetry }: { state: BoardStatePayload; onRetry: () => void }) {
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
    const visible = state.cards.filter((card) => state.scope.projects.includes(card.project));
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
                            <Card key={card.key} card={card} showAvatar={showAvatar} onOpenJira={openJira} />
                        ))}
                    </section>
                );
            })}
        </main>
    );
}
