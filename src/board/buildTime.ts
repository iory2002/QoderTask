import type { BuildFact } from '../models/Board';
import { epochOf } from '../services/time';

/**
 * 展示时间一律走这里。
 *
 * 两个理由：
 * 1. 时区固定 UTC+8，不跟机器 locale 走 —— 同一份事实在扩展（推导依据）和
 *    WebView（详情卡片）两侧必须显示成同一个时间，否则用户没法核对。
 * 2. 秒和毫秒要分清楚：GitLab 给的是 `2026-11-11T07:50:18.850Z`（850 是毫秒，
 *    Z 是 UTC），直接贴原文既难读又容易被当成时间的一部分。
 */
const DISPLAY_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * epoch 毫秒（或 ISO 时间串）→ `2026-11-11 15:50:18`。
 * withZone = true 时补上 `（UTC+8）`，用在「哪一天几点」会被误解的位置。
 * 解析不了返回 null：调用方必须自己决定说「未知」，不要编一个日期。
 */
export function formatStamp(value: string | number | null | undefined, withZone = false): string | null {
    const epoch = epochOf(value);
    if (epoch === null) {
        return null;
    }
    const shifted = new Date(epoch + DISPLAY_OFFSET_MS);
    const pad = (part: number) => String(part).padStart(2, '0');
    const date = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
    const time = `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;
    return withZone ? `${date} ${time}（UTC+8）` : `${date} ${time}`;
}

/**
 * 构建结束时间 = 开始 + Jenkins 的 duration。
 *
 * 进行中的构建（result 为 null）没有结束时间：Jenkins 的 duration 那时是「已跑了多久」，
 * 拿它当结束时间会算出一个不断往后跳的假时间。没有 duration 也一律算未知。
 */
export function buildEndOf(build: Pick<BuildFact, 'result' | 'timestamp' | 'durationMs'>): number | null {
    if (build.result === null || typeof build.durationMs !== 'number' || build.durationMs <= 0) {
        return null;
    }
    return build.timestamp + build.durationMs;
}

/**
 * 构建时间窗（只描述事实，不带标点结构）：
 *   已完成 → `开始于 X，结束于 Y（UTC+8）`
 *   进行中 → `开始于 X（UTC+8）`
 */
export function buildWindowOf(build: Pick<BuildFact, 'result' | 'timestamp' | 'durationMs'>): string {
    const start = formatStamp(build.timestamp);
    if (start === null) {
        return '开始时间未知';
    }
    const end = buildEndOf(build);
    return end === null ? `开始于 ${start}（UTC+8）` : `开始于 ${start}，结束于 ${formatStamp(end)}（UTC+8）`;
}
