import { useCallback, useState } from 'preact/hooks';

import { ALL_STAGE_FILTERS } from '../src/board/stageFilter';
import { Board } from './components/Board';
import { Banners } from './components/Banners';
import { DetailPanel } from './components/DetailPanel';
import { Loading } from './components/Loading';
import { TopBar } from './components/TopBar';
import { useBoardModel } from './useBoardModel';

/**
 * 看板是只读视图：卡片看交付事实，改状态去 Jira。
 * 这里刻意没有表单、闸门、乐观更新——Jira 的 transition 屏幕填不了，
 * 硬做拖拽只会让用户卡在半路的表单里。
 */
export function App() {
    const model = useBoardModel();
    const state = model.state;
    const [selectedKey, setSelectedKey] = useState<string | null>(null);

    const closeDetail = useCallback(() => setSelectedKey(null), []);

    // 当前的详情从 state 里取，轮询更新会直接反映在浮层上，不抢焦点
    const selected = state && selectedKey ? state.cards.find((card) => card.key === selectedKey) : undefined;

    // 首屏：还没有任何列。此时不能把空看板当成「读不到」，也不能弹告警
    const firstLoad = !state || (state.loading && state.columns.length === 0);

    return (
        <div class="app">
            <TopBar model={model} />
            {!firstLoad && model.error ? (
                <div class="banners">
                    <div class="banner error">{model.error}</div>
                </div>
            ) : null}
            {!firstLoad && state ? (
                <Banners notices={state.notices} />
            ) : null}
            {firstLoad ? (
                <Loading />
            ) : (
                <Board
                    state={state!}
                    onRetry={() => model.refresh(true)}
                    onOpenDetail={setSelectedKey}
                    onResetStages={() => model.setStages(ALL_STAGE_FILTERS)}
                />
            )}
            {state && selected ? <DetailPanel card={selected} onClose={closeDetail} /> : null}
        </div>
    );
}
