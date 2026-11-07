import { useCallback, useState } from 'preact/hooks';

import { Board } from './components/Board';
import { Banners } from './components/Banners';
import { DetailPanel } from './components/DetailPanel';
import { TopBar } from './components/TopBar';
import { useBoardModel } from './useBoardModel';

export function App() {
    const model = useBoardModel();
    const state = model.state;
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const closeDetail = useCallback(() => setSelectedKey(null), []);

    // 详情从当前 state 里取，所以轮询更新会直接反映在浮层上，不会抢焦点
    const selected = state && selectedKey ? state.cards.find((card) => card.key === selectedKey) : undefined;

    return (
        <div class="app">
            <TopBar model={model} />
            {model.error ? (
                <div class="banners">
                    <div class="banner error">{model.error}</div>
                </div>
            ) : null}
            {state ? <Banners notices={state.notices} stale={state.freshness.stale} /> : null}
            {state ? (
                <Board state={state} onRetry={() => model.refresh(true)} onOpenDetail={setSelectedKey} />
            ) : (
                <div class="placeholder">
                    <h3>正在读取 Jira 看板…</h3>
                    <span>首次加载会拉取 board 配置与活跃 sprint。</span>
                </div>
            )}
            {state && selected ? <DetailPanel card={selected} state={state} onClose={closeDetail} /> : null}
        </div>
    );
}
