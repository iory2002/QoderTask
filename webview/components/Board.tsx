import { useState } from 'preact/hooks';

import type { BoardColumn, BoardStatePayload, ColumnDropRule, TransitionAvailability } from '../../src/models/Board';
import { post } from '../api';
import { showToast } from '../toast';
import { Card } from './Card';

export interface BoardProps {
    state: BoardStatePayload;
    availability: TransitionAvailability | null;
    onRetry: () => void;
    onOpenDetail: (key: string) => void;
    onDragStart: (key: string) => void;
    onDragEnd: () => void;
    /** 落在合法列上：07 只提示「还不能写」，08 起弹表单 */
    onDrop: (cardKey: string, column: BoardColumn, rule: ColumnDropRule) => void;
}

export function Board({
    state,
    availability,
    onRetry,
    onOpenDetail,
    onDragStart,
    onDragEnd,
    onDrop,
}: BoardProps) {
    const [draggingKey, setDraggingKey] = useState<string | null>(null);
    const [hoverColumnId, setHoverColumnId] = useState<string | null>(null);

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
    const rules = availability && availability.key === draggingKey ? availability.drops : undefined;

    const beginDrag = (key: string) => {
        setDraggingKey(key);
        onDragStart(key);
    };

    const endDrag = () => {
        setDraggingKey(null);
        setHoverColumnId(null);
        onDragEnd();
    };

    return (
        <main class="board">
            {state.columns.map((column) => {
                const cards = visible.filter((card) => column.statusIds.includes(card.statusId));
                const isDone = column.name.toLowerCase() === 'done';
                const rule = rules?.find((candidate) => candidate.columnId === column.id);

                // 拖拽期间：非法列直接变灰（不是拖到上面才报错）
                const locked = Boolean(draggingKey) && rule !== undefined && !rule.legal;
                const classes = ['col'];
                if (isDone) {
                    classes.push('done');
                }
                if (locked) {
                    classes.push('locked');
                }
                if (hoverColumnId === column.id && rule) {
                    classes.push(rule.legal ? 'dragover' : 'reject');
                }

                return (
                    <section
                        class={classes.join(' ')}
                        key={column.id}
                        data-column={column.id}
                        onDragOver={(event) => {
                            if (!draggingKey) {
                                return;
                            }
                            // 非法列也收 drop 事件：否则用户得不到任何解释
                            event.preventDefault();
                            setHoverColumnId(column.id);
                        }}
                        onDragLeave={() => setHoverColumnId((current) => (current === column.id ? null : current))}
                        onDrop={(event) => {
                            event.preventDefault();
                            setHoverColumnId(null);
                            if (!draggingKey) {
                                return;
                            }
                            if (!rule) {
                                showToast('还没拿到这张卡可用的动作，请稍后重新拖一次', 'error');
                                endDrag();
                                return;
                            }
                            if (!rule.legal) {
                                showToast(rule.reason ?? `不能放到「${column.name}」`, 'error');
                                endDrag();
                                return;
                            }
                            onDrop(draggingKey, column, rule);
                            endDrag();
                        }}
                    >
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
                                onDragStart={() => beginDrag(card.key)}
                                onDragEnd={endDrag}
                                pending={state.pendingKeys.includes(card.key)}
                            />
                        ))}
                    </section>
                );
            })}
        </main>
    );
}
