/**
 * 首次加载的骨架屏。
 *
 * 存在的理由：`board:ready` 时扩展会先把当前状态推过来，而那一刻 columns 还是空的。
 * 如果前端直接渲染看板，用户看到的是「五列都没有 = 读不到」；带上 loading 后
 * 这里显示骨架，加载完成再换成真看板。
 */
export function Loading({
    label = '正在加载看板…',
    hint = '首次加载要拉 board 配置、活跃 sprint，以及 GitLab / Jenkins 的交付事实，通常几秒钟。',
}: {
    label?: string;
    hint?: string;
}) {
    return (
        <div class="loading" role="status" aria-live="polite">
            <div class="loading-label">
                <span class="spinner" />
                <span>{label}</span>
            </div>

            <div class="loading-board" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((column) => (
                    <div class="loading-col" key={column}>
                        <div class="loading-col-head" />
                        {[0, 1, 2].map((card) => (
                            <div
                                class="loading-card"
                                key={card}
                                style={`animation-delay:${(column * 3 + card) * 70}ms`}
                            />
                        ))}
                    </div>
                ))}
            </div>

            <div class="hint">{hint}</div>
        </div>
    );
}
