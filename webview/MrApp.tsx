import { useCallback, useEffect, useState } from 'preact/hooks';

import type { MrCard } from '../src/models/MrBoard';
import { Banners } from './components/Banners';
import { Loading } from './components/Loading';
import { MrBoard } from './components/MrBoard';
import { MrDetailPanel } from './components/MrDetailPanel';
import { MrTopBar } from './components/MrTopBar';
import { post } from './mrApi';
import { useMrBoardModel } from './useMrBoardModel';

type Perspective = 'review-queue' | 'my-mrs';

interface MenuState {
    card: MrCard;
    perspective: Perspective;
    x: number;
    y: number;
}

/**
 * MR 看板：两列只读视图。写操作（Approve / 评论 / 合并）留在 GitLab。
 * 右键才有动作：评审交接、打开 GitLab、复制链接。
 */
export function MrApp() {
    const model = useMrBoardModel();
    const state = model.state;
    const [selected, setSelected] = useState<{ iid: number; projectPath: string } | null>(null);
    const [menu, setMenu] = useState<MenuState | null>(null);

    const openExternal = useCallback((url: string) => {
        post({ type: 'mr:openExternal', payload: { url } });
    }, []);
    const openJira = useCallback((key: string) => {
        post({ type: 'mr:openJira', payload: { key } });
    }, []);
    const review = useCallback((card: MrCard) => {
        post({ type: 'mr:review', payload: { iid: card.iid, projectPath: card.projectPath } });
    }, []);
    const copyLink = useCallback((card: MrCard) => {
        post({ type: 'mr:copyLink', payload: { url: card.url } });
    }, []);

    const allCards = state ? [...state.reviewQueue, ...state.myMrs] : [];
    const selectedCard = selected
        ? allCards.find((card) => card.iid === selected.iid && card.projectPath === selected.projectPath)
        : undefined;
    const selectedPerspective: Perspective =
        selectedCard && state?.reviewQueue.includes(selectedCard) ? 'review-queue' : 'my-mrs';

    // 首屏：还没有任何数据。此时空列不代表「真的没有」，先给骨架
    const firstLoad = !state || (state.loading && allCards.length === 0);

    return (
        <div class="app">
            <MrTopBar model={model} />

            {!firstLoad && model.error ? (
                <div class="banners">
                    <div class="banner error">{model.error}</div>
                </div>
            ) : null}
            {!firstLoad && state ? <Banners notices={state.notices} stale={state.freshness.stale} /> : null}

            {firstLoad ? (
                <Loading
                    label="正在加载 MR 看板…"
                    hint="首次加载要取 GitLab 身份、按 reviewer / author 拉 MR，再逐个查审批，通常几秒钟。"
                />
            ) : (
                <MrBoard
                    state={state!}
                    onOpen={(card) => setSelected({ iid: card.iid, projectPath: card.projectPath })}
                    onMenu={(card, perspective, x, y) => setMenu({ card, perspective, x, y })}
                    onOpenJira={openJira}
                />
            )}

            {state && selectedCard ? (
                <MrDetailPanel
                    card={selectedCard}
                    perspective={selectedPerspective}
                    onClose={() => setSelected(null)}
                    onOpenGitLab={openExternal}
                    onReview={(card) => {
                        review(card);
                        setSelected(null);
                    }}
                    onOpenJira={openJira}
                />
            ) : null}

            {menu ? (
                <MrContextMenu
                    menu={menu}
                    onClose={() => setMenu(null)}
                    onReview={review}
                    onOpenGitLab={openExternal}
                    onCopyLink={copyLink}
                />
            ) : null}
        </div>
    );
}

function MrContextMenu({
    menu,
    onClose,
    onReview,
    onOpenGitLab,
    onCopyLink,
}: {
    menu: MenuState;
    onClose: () => void;
    onReview: (card: MrCard) => void;
    onOpenGitLab: (url: string) => void;
    onCopyLink: (card: MrCard) => void;
}) {
    useEffect(() => {
        const onAnyClick = () => onClose();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('click', onAnyClick);
        window.addEventListener('contextmenu', onAnyClick);
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('click', onAnyClick);
            window.removeEventListener('contextmenu', onAnyClick);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [onClose]);

    const width = 220;
    const height = 132;
    const left = Math.max(8, Math.min(menu.x, window.innerWidth - width - 8));
    const top = Math.max(8, Math.min(menu.y, window.innerHeight - height - 8));
    const reviewDisabled = menu.perspective === 'my-mrs';

    const run = (action: () => void) => () => {
        action();
        onClose();
    };

    return (
        <div class="ctx-menu" style={`left:${left}px; top:${top}px; width:${width}px`} role="menu">
            <button
                class={reviewDisabled ? 'ctx-item disabled' : 'ctx-item'}
                role="menuitem"
                disabled={reviewDisabled}
                title={reviewDisabled ? '自己提交的 MR 不需要自己审' : '拉取 diff 并复制审查指令'}
                onClick={run(() => onReview(menu.card))}
            >
                用 Qoder 审查此 MR
            </button>
            <div class="ctx-sep" />
            <button class="ctx-item" role="menuitem" onClick={run(() => onOpenGitLab(menu.card.url))}>
                在 GitLab 中打开
            </button>
            <button class="ctx-item" role="menuitem" onClick={run(() => onCopyLink(menu.card))}>
                复制链接
            </button>
        </div>
    );
}
