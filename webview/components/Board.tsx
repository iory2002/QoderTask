import { cardsInScope } from '../../src/board/cardScope';
import { cardMatchesStages, isAllStages } from '../../src/board/stageFilter';
import type { BoardStatePayload } from '../../src/models/Board';
import { post } from '../api';
import { Card } from './Card';

export interface BoardProps {
    state: BoardStatePayload;
    onRetry: () => void;
    onOpenDetail: (key: string) => void;
    /** 阶段筛选把卡片全挡住时的一键还原 */
    onResetStages: () => void;
}

/**
 * 只读看板。
 *
 * 这里刻意不做拖拽：Jira 的 transition 大多带必填字段（screen），
 * 看板里填不了，硬做只会让用户在半路的表单里卡住。
 * 改状态一律走「在 Jira 中打开」。
 */
export function Board({ state, onRetry, onOpenDetail, onResetStages }: BoardProps) {
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

    // 隐藏列只影响渲染：cards 仍是全量，列计数与角标都不看这份集合
    const hidden = new Set(state.hiddenColumnIds);
    const columns = state.columns.filter((column) => !hidden.has(column.id));
    if (columns.length === 0) {
        return (
            <div class="placeholder">
                <h3>所有列都被隐藏了</h3>
                <span>设置 pcBoard.hiddenColumns 里列了看板的全部列；留空或删掉几项即可恢复。</span>
            </div>
        );
    }

    const openJira = (key: string) => post({ type: 'card:openJira', payload: { key } });
    const openBuild = (url: string) => post({ type: 'board:openExternal', payload: { url } });
    // 纯视图过滤：数据是全量拉回来的，切「只看我的」/项目 chip / 阶段徽章都不发请求
    const scoped = cardsInScope(state.cards, state.scope);
    // 没有 GitLab 凭据时卡片根本不出徽章，阶段筛选也就无从谈起
    const showStage = state.capabilities.gitlab;
    const stageFilterOn = showStage && !isAllStages(state.view.stages);
    const visible = stageFilterOn
        ? scoped.filter((card) => cardMatchesStages(card, state.view.stages))
        : scoped;
    const showAvatar = !state.scope.onlyMine;

    // 筛选把本来有卡的看板挡成了空：给一个明确的空态与还原入口，
    // 而不是让用户对着一排「空」列以为数据丢了
    if (stageFilterOn && scoped.length > 0 && visible.length === 0) {
        return (
            <div class="placeholder">
                <h3>没有卡片带这些阶段徽章</h3>
                <span>
                    当前范围里有 {scoped.length} 张卡，但没有一张命中勾选的
                    {state.view.stages.length === 0 ? '（一个都没勾）' : ` ${state.view.stages.length} 种徽章`}。
                </span>
                <button class="btn primary" onClick={onResetStages}>
                    显示全部阶段
                </button>
            </div>
        );
    }

    return (
        <main class="board">
            {columns.map((column) => {
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
                                density={state.view.density}
                                showStage={showStage}
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
