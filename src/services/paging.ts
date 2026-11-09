/**
 * GitLab 列表接口的分页取数。
 *
 * 两个规则：
 * 1. 翻到「不满一页」为止，绝不按固定的 3 页硬切——90 天窗口里 MR 数量会长，
 *    被截断的后果是已合入的 MR 消失，卡片从「已合入」退回「未提交」。
 * 2. 到上限后多探一页：只有第 maxPages+1 页**还有数据**才算截断，
 *    恰好 1000 条时不会误报。
 */

export const PAGE_SIZE = 100;
/** 单次取数最多 10 页（1000 条）；再多的项目先看最近的，但必须明说被截断 */
export const MAX_PAGES = 10;

export interface PageBatch<T> {
    rows: T[];
    /** true = 服务端还有数据没取回来，界面必须告警 */
    truncated: boolean;
}

export async function fetchAllPages<T>(
    fetchPage: (page: number) => Promise<T[]>,
    pageSize = PAGE_SIZE,
    maxPages = MAX_PAGES
): Promise<PageBatch<T>> {
    const rows: T[] = [];
    const limit = maxPages * pageSize;

    for (let page = 1; page <= maxPages + 1; page += 1) {
        const chunk = await fetchPage(page);

        if (page === maxPages + 1) {
            // 探测页：有内容说明已经超过上限
            return { rows, truncated: chunk.length > 0 };
        }

        rows.push(...chunk.slice(0, Math.max(0, limit - rows.length)));
        if (chunk.length < pageSize) {
            return { rows, truncated: false };
        }
    }

    return { rows, truncated: false };
}
