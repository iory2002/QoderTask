import type { BoardStatePayload } from '../../src/models/Board';

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

    return (
        <main class="board">
            {state.columns.map((column) => {
                const cards = state.cards.filter((card) => column.statusIds.includes(card.statusId));
                const isDone = column.name.toLowerCase() === 'done';
                return (
                    <section class={isDone ? 'col done' : 'col'} key={column.id}>
                        <h2>
                            {column.name}
                            <span>{cards.length}</span>
                        </h2>
                        {cards.length === 0 ? <div class="col-empty">空</div> : null}
                    </section>
                );
            })}
        </main>
    );
}
