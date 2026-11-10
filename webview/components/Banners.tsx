import type { BoardNotice } from '../../src/models/Board';

/**
 * 顶部横幅。
 *
 * 「刷新失败」与「数据旧了」是两件不同的事，以前都写成「最近一次刷新失败」，
 * 结果后台正在慢慢刷新时也会报失败。现在按 `freshness.error` 分开说。
 */
export function Banners({
    notices,
    stale,
    error,
    loading,
    lastSuccessAt,
}: {
    notices: BoardNotice[];
    stale: boolean;
    error: string | null;
    loading: boolean;
    lastSuccessAt: number | null;
}) {
    const all = stale ? [staleBanner(error, loading, lastSuccessAt), ...notices] : notices;

    if (all.length === 0) {
        return null;
    }

    return (
        <div class="banners">
            {all.map((notice, index) => (
                <div class={`banner ${notice.level}`} key={`${notice.level}-${index}`}>
                    <span>{notice.message}</span>
                    {notice.hint ? <span class="hint">· {notice.hint}</span> : null}
                </div>
            ))}
        </div>
    );
}

function staleBanner(error: string | null, loading: boolean, lastSuccessAt: number | null): BoardNotice {
    if (error) {
        return {
            level: 'warn',
            message: `刷新失败：${error}`,
            hint: '下面显示的是上次成功的数据',
        };
    }
    const at = lastSuccessAt === null ? null : new Date(lastSuccessAt).toLocaleTimeString();
    return {
        level: 'warn',
        message: `数据可能过期${at ? `（上次同步 ${at}）` : ''}`,
        hint: loading ? '正在后台刷新，这里先显示上次成功的数据' : undefined,
    };
}

