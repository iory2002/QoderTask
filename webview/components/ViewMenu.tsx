import { useEffect, useRef, useState } from 'preact/hooks';

import { cardsInScope } from '../../src/board/cardScope';
import { ALL_STAGE_FILTERS, STAGE_FILTERS, countStageFilters, isAllStages } from '../../src/board/stageFilter';
import type { BoardStatePayload, CardDensity } from '../../src/models/Board';
import type { BoardModel } from '../useBoardModel';

type Submenu = 'columns' | 'stages' | null;

/**
 * 顶栏「视图」菜单：只看我的、显示列、交付阶段、详细 / 精简。
 *
 * 勾选类（只看我的、显示列、交付阶段）不关闭菜单，可以连着点几项；
 * 密度是单选，选完就关。
 *
 * 勾选结果由 useBoardModel 当场应用（本地即改即画），同时发给宿主保存设置；
 * 不等宿主回帧，所以连着点几下都对，也不会整板重绘。二级菜单只在整个菜单
 * 外面才收起，鼠标在勾选框之间移动不会把它关掉。
 */
export function ViewMenu({ state, model }: { state: BoardStatePayload; model: BoardModel }) {
    const [open, setOpen] = useState(false);
    const [submenu, setSubmenu] = useState<Submenu>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);

    // 点菜单外面、按 Esc 关闭：菜单是浮层，不该挡住看板
    useEffect(() => {
        if (!open) {
            return;
        }
        const onPointerDown = (event: MouseEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) {
                setOpen(false);
                setSubmenu(null);
            }
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false);
                setSubmenu(null);
            }
        };
        window.addEventListener('mousedown', onPointerDown);
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('mousedown', onPointerDown);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    const hidden = new Set(state.hiddenColumnIds);
    const selectedStages = new Set(state.view.stages);
    const stageFilterOn = !isAllStages(state.view.stages);
    // 没有 GitLab 凭据时卡片根本不出徽章，筛选也就无从谈起
    const stagesAvailable = state.capabilities.gitlab;
    // 计数看「当前范围里的全量卡片」，不受阶段勾选影响：
    // 否则取消某项后它的数字变成 0，用户再也勾不回来
    const stageCounts = countStageFilters(cardsInScope(state.cards, state.scope));

    // 增删交给 model：它手上是本地最新名单，连点不会用上一次回帧的旧集合
    const toggleColumn = (id: string) => {
        model.toggleColumn(id);
    };

    const close = () => {
        setOpen(false);
        setSubmenu(null);
    };

    const chooseDensity = (density: CardDensity) => {
        model.setDensity(density);
        close();
    };

    /** 二级菜单行的键盘操作：右 / 回车 / 空格展开，左收起 */
    const subRowKeys = (name: Exclude<Submenu, null>) => (event: KeyboardEvent) => {
        if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setSubmenu(name);
        } else if (event.key === 'ArrowLeft') {
            setSubmenu(null);
        }
    };

    return (
        <div class="view-menu-wrap" ref={rootRef}>
            <button
                class={open ? 'btn active' : 'btn'}
                aria-haspopup="menu"
                aria-expanded={open}
                title="视图：只看我的 / 显示列 / 交付阶段 / 详细·精简"
                onClick={() => (open ? close() : setOpen(true))}
            >
                视图 <span class="chev">▾</span>
                {stageFilterOn || hidden.size > 0 ? <span class="view-dot" title="有视图筛选正在生效" /> : null}
            </button>

            {open ? (
                <div class="view-menu" role="menu" onMouseLeave={() => setSubmenu(null)}>
                    <label class="view-item">
                        <input
                            type="checkbox"
                            checked={state.scope.onlyMine}
                            onChange={(event) =>
                                model.setScope(
                                    state.scope.projects,
                                    (event.currentTarget as HTMLInputElement).checked
                                )
                            }
                        />
                        只看我的
                    </label>

                    {/* 悬停展开；收起交给整个菜单的 onMouseLeave —— 二级菜单是这里的
                        DOM 子节点，鼠标移进去不算离开，勾选时不会被抖掉 */}
                    <div class="view-sub" onMouseEnter={() => setSubmenu('columns')}>
                        <div
                            class="view-sub-row"
                            role="menuitem"
                            aria-haspopup="menu"
                            aria-expanded={submenu === 'columns'}
                            tabIndex={0}
                            onClick={() => setSubmenu('columns')}
                            onKeyDown={subRowKeys('columns')}
                        >
                            <span>显示列</span>
                            <span class="view-sub-meta">
                                {hidden.size > 0 ? <span class="view-count">隐藏 {hidden.size}</span> : null}
                                <span class="chev">▸</span>
                            </span>
                        </div>

                        {submenu === 'columns' ? (
                            <div class="view-submenu" role="menu" aria-label="显示列">
                                {state.columns.length === 0 ? (
                                    <div class="view-empty">还没读到看板列</div>
                                ) : null}
                                {state.columns.map((column) => (
                                    <label class="view-item" key={column.id}>
                                        <input
                                            type="checkbox"
                                            checked={!hidden.has(column.id)}
                                            onChange={() => toggleColumn(column.id)}
                                        />
                                        {column.name}
                                    </label>
                                ))}
                            </div>
                        ) : null}
                    </div>

                    <div class="view-sub" onMouseEnter={() => stagesAvailable && setSubmenu('stages')}>
                        <div
                            class={stagesAvailable ? 'view-sub-row' : 'view-sub-row disabled'}
                            role="menuitem"
                            aria-haspopup="menu"
                            aria-expanded={submenu === 'stages'}
                            aria-disabled={!stagesAvailable}
                            tabIndex={0}
                            title={
                                stagesAvailable
                                    ? '按卡片上的交付阶段徽章筛选；全选 = 不过滤'
                                    : '没有 GitLab 凭据，卡片不出阶段徽章，筛选无从谈起'
                            }
                            onClick={() => stagesAvailable && setSubmenu('stages')}
                            onKeyDown={stagesAvailable ? subRowKeys('stages') : undefined}
                        >
                            <span>交付阶段</span>
                            <span class="view-sub-meta">
                                {stageFilterOn ? (
                                    <span class="view-count on">
                                        {selectedStages.size}/{ALL_STAGE_FILTERS.length}
                                    </span>
                                ) : null}
                                <span class="chev">▸</span>
                            </span>
                        </div>

                        {submenu === 'stages' && stagesAvailable ? (
                            <div class="view-submenu stage-menu" role="menu" aria-label="交付阶段">
                                <div class="view-actions">
                                    <button
                                        class="view-link"
                                        disabled={!stageFilterOn}
                                        onClick={() => model.setStages(ALL_STAGE_FILTERS)}
                                    >
                                        全选
                                    </button>
                                    <button
                                        class="view-link"
                                        disabled={selectedStages.size === 0}
                                        onClick={() => model.setStages([])}
                                    >
                                        清空
                                    </button>
                                </div>
                                {STAGE_FILTERS.map((option) => (
                                    <label class="view-item stage-item" key={option.id} title={option.hint}>
                                        <input
                                            type="checkbox"
                                            checked={selectedStages.has(option.id)}
                                            onChange={() => model.toggleStage(option.id)}
                                        />
                                        <span class={`stage-dot ${option.cls}`} />
                                        <span class="stage-name">{option.label}</span>
                                        <span class={stageCounts[option.id] === 0 ? 'view-count zero' : 'view-count'}>
                                            {stageCounts[option.id]}
                                        </span>
                                    </label>
                                ))}
                                <div class="view-note">勾选只看这些徽章；卡片数据与角标不受影响</div>
                            </div>
                        ) : null}
                    </div>

                    <div class="view-sep" role="separator" />

                    <label class="view-item">
                        <input
                            type="radio"
                            name="board-density"
                            checked={state.view.density === 'detailed'}
                            onChange={() => chooseDensity('detailed')}
                        />
                        详细
                    </label>
                    <label class="view-item">
                        <input
                            type="radio"
                            name="board-density"
                            checked={state.view.density === 'compact'}
                            onChange={() => chooseDensity('compact')}
                        />
                        精简
                    </label>
                </div>
            ) : null}
        </div>
    );
}