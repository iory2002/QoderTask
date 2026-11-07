import type { BoardStatePayload } from '../../src/models/Board';

export function Board({ state }: { state: BoardStatePayload }) {
    if (state.columns.length === 0) {
        return (
            <div class="placeholder">
                <h3>看板骨架已就绪</h3>
                <span>还没有从 Jira board 配置读到列定义。</span>
            </div>
        );
    }

    return (
        <main class="board">
            {state.columns.map((column) => {
                const count = state.cards.filter((card) => card.statusId && column.statusIds.includes(card.statusId)).length;
                return (
                    <section class="col" key={column.id}>
                        <h2>
                            {column.name}
                            <span>{count}</span>
                        </h2>
                        {count === 0 ? <div class="col-empty">空</div> : null}
                    </section>
                );
            })}
        </main>
    );
}
