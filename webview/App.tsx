import { Board } from './components/Board';
import { TopBar } from './components/TopBar';
import { useBoardModel } from './useBoardModel';

export function App() {
    const model = useBoardModel();
    const state = model.state;

    return (
        <div class="app">
            <TopBar model={model} />
            {model.error ? (
                <div class="banners">
                    <div class="banner error">{model.error}</div>
                </div>
            ) : null}
            {state ? (
                <Board state={state} />
            ) : (
                <div class="placeholder">
                    <h3>正在读取 Jira 看板…</h3>
                    <span>首次加载会拉取 board 配置与活跃 sprint。</span>
                </div>
            )}
        </div>
    );
}
