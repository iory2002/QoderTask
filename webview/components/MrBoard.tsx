import type { MrBoardPayload, MrCard } from '../../src/models/MrBoard';
import { MrCardView } from './MrCard';

export function MrBoard({
    state,
    onOpen,
    onMenu,
    onOpenJira,
}: {
    state: MrBoardPayload;
    onOpen: (card: MrCard) => void;
    onMenu: (card: MrCard, perspective: 'review-queue' | 'my-mrs', x: number, y: number) => void;
    onOpenJira: (key: string) => void;
}) {
    const showRepo = state.scope.length > 1;

    return (
        <main class="board">
            <section class="col" data-column="review-queue">
                <h2>
                    Reviewer 包含我
                    <span>{state.reviewQueue.length}</span>
                </h2>
                {state.reviewQueue.length === 0 ? (
                    <div class="col-empty">没有待你审的 MR</div>
                ) : (
                    state.reviewQueue.map((card) => (
                        <MrCardView
                            card={card}
                            key={`${card.projectPath}!${card.iid}`}
                            perspective="review-queue"
                            showRepo={showRepo}
                            onOpen={onOpen}
                            onMenu={onMenu}
                            onOpenJira={onOpenJira}
                        />
                    ))
                )}
            </section>

            <section class="col" data-column="my-mrs">
                <h2>
                    我提交的
                    <span>{state.myMrs.length}</span>
                </h2>
                {state.myMrs.length === 0 ? (
                    <div class="col-empty">没有未合入的 MR</div>
                ) : (
                    state.myMrs.map((card) => (
                        <MrCardView
                            card={card}
                            key={`${card.projectPath}!${card.iid}`}
                            perspective="my-mrs"
                            showRepo={showRepo}
                            onOpen={onOpen}
                            onMenu={onMenu}
                            onOpenJira={onOpenJira}
                        />
                    ))
                )}
            </section>
        </main>
    );
}
