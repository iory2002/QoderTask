import type { BoardCard, BoardScope } from '../models/Board';

/**
 * 卡片是否落在当前看板范围里。
 *
 * 看板与「交付阶段」菜单的计数共用这一份：两处各写一遍的话，
 * 菜单里的数字迟早和看板上实际能看到的卡片对不上。
 * 「只看我的」是本地过滤，钉住的卡（dev 模式）始终可见。
 */
export function inScope(card: BoardCard, scope: BoardScope): boolean {
    return scope.projects.includes(card.project) && (!scope.onlyMine || card.isMine || card.pinned);
}

/** 当前范围里的卡片，顺序不变 */
export function cardsInScope(cards: BoardCard[], scope: BoardScope): BoardCard[] {
    return cards.filter((card) => inScope(card, scope));
}