import type { BoardNotice } from '../../src/models/Board';

export function Banners({ notices, stale }: { notices: BoardNotice[]; stale: boolean }) {
    const all = stale
        ? [
              {
                  level: 'warn' as const,
                  message: '数据可能过期：最近一次刷新失败，下面显示的是上次成功的数据',
                  hint: undefined,
              },
              ...notices.filter((notice) => notice.level !== 'warn' || notice.message !== '数据可能过期'),
          ]
        : notices;

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
