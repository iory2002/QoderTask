/**
 * 服务端时间 → epoch 毫秒。
 *
 * GitLab / Jira 返回的是带偏移的 ISO 8601（例如 `2026-11-09T20:55:00+08:00`），
 * 也有接口直接给 Unix 毫秒。任何「截前 16 个字符再比」的写法都会把 +08:00 当成
 * 字符串内容，得出「提交晚于合入」这类反向结论。比较一律先过这里。
 */

export function epochOf(value: string | number | null | undefined): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
}

/** 排序用的兜底值：解析失败排在最早，但调用方要知道这是「未知」而不是「1970」 */
export function epochOrZero(value: string | number | null | undefined): number {
    return epochOf(value) ?? 0;
}

/** value 是否不早于 reference；任一侧解析失败都返回 false（无法证明就不下结论） */
export function isAtOrAfter(
    value: string | number | null | undefined,
    reference: string | number | null | undefined
): boolean {
    const left = epochOf(value);
    const right = epochOf(reference);
    return left !== null && right !== null && left >= right;
}
