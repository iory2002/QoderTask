import type { MrFact } from '../models/Board';
import { epochOf } from './time';

/**
 * 合入后多久没推进才算「我拖住的卡」。
 *
 * 写死 3 天，不做配置：多一个开关就多一个没人调对的旋钮，
 * 而这一行只在详情里出现，误报的代价很小。
 */
export const STALLED_AFTER_DAYS = 3;

const DAY_MS = 24 * 3600 * 1000;

/** 该卡所有关联 MR 中最早的合入时间；没有已合入的 MR 时为 null */
export function daysSinceEarliestMerge(mrs: MrFact[], now: number): number | null {
    const times = mrs
        .map((mr) => epochOf(mr.mergedAt))
        .filter((epoch): epoch is number => epoch !== null);
    if (times.length === 0) {
        return null;
    }
    const days = Math.floor((now - Math.min(...times)) / DAY_MS);
    // 时钟回拨时不要显示负天数
    return days < 0 ? 0 : days;
}

/** 超过阈值才返回；未合入、时间解析失败、未到阈值都返回 null（整行省略） */
export function stalledAfterMerge(mrs: MrFact[], now: number): { days: number } | null {
    const days = daysSinceEarliestMerge(mrs, now);
    if (days === null || days < STALLED_AFTER_DAYS) {
        return null;
    }
    return { days };
}
