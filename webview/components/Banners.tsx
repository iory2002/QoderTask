import type { BoardNotice } from '../../src/models/Board';

/**
 * 顶部横幅。
 *
 * 只报「真出事了」：取数失败的通知由后端放进 `notices`（`freshness.error` 那条），
 * 这里原样展示。单纯「数据旧了」不占一行——顶栏的「数据可能过期 · 时间 · 张数」
 * 已经说清楚了，再挂一条横幅只是重复。
 */
export function Banners({ notices }: { notices: BoardNotice[] }) {
    if (notices.length === 0) {
        return null;
    }

    return (
        <div class="banners">
            {notices.map((notice, index) => (
                <div class={`banner ${notice.level}`} key={`${notice.level}-${index}`}>
                    <span>{notice.message}</span>
                    {notice.hint ? <span class="hint">· {notice.hint}</span> : null}
                </div>
            ))}
        </div>
    );
}

