import type { BoardCard } from '../models/Board';
import type { MrCard } from '../models/MrBoard';
import type { JiraBadgeMode, MrBadgeMode } from '../board/config';

/**
 * 活动栏图标只有一个数字位（ViewBadge.value 是单值），
 * 所以这里统一返回「主数字 + 副数字」：主数字上图标，两个都进侧边栏。
 */
export interface BadgeCounts {
    primary: number;
    secondary: number;
}

export interface JiraBadgeInput {
    mode: JiraBadgeMode;
    /** 只统计指派给自己的 issue */
    onlyMine: boolean;
    developmentStatuses: string[];
    testingStatuses: string[];
}

/** 状态名来自 Jira 配置，大小写与首尾空格都不该影响归类 */
function normalize(value: string): string {
    return value.trim().toLowerCase();
}

function toSet(statuses: string[]): Set<string> {
    return new Set(statuses.map(normalize).filter(Boolean));
}

/**
 * 主数字 / 副数字的含义随 mode 调换，侧边栏的标签必须跟着一起换：
 * 否则 `mode: 'testing'` 时图标上是「测试中」，条目里却写成「开发中 N · 测试中 N」，数字串位。
 */
export function jiraBadgeLabels(mode: JiraBadgeMode): [string, string] {
    return mode === 'testing' ? ['测试中', '开发中'] : ['开发中', '测试中'];
}

export function mrBadgeLabels(mode: MrBadgeMode): [string, string] {
    return mode === 'awaitingOthers' ? ['等别人审', '待我审'] : ['待我审', '等别人审'];
}

/**
 * Jira：未完成的工作按状态名分两组，同一张卡只归一组（先开发后测试）。
 *
 * 口径是「当前 sprint 里还没做完的我的卡」，与看板的列无关：
 * 列可以改名，状态名才是用户配置的对象。
 */
export function countJiraBadges(cards: BoardCard[], input: JiraBadgeInput): BadgeCounts {
    const development = toSet(input.developmentStatuses);
    const testing = toSet(input.testingStatuses);

    let inDevelopment = 0;
    let inTesting = 0;

    for (const card of cards) {
        if (input.onlyMine && !card.isMine) {
            continue;
        }
        const status = normalize(card.statusName ?? '');
        if (development.has(status)) {
            inDevelopment += 1;
        } else if (testing.has(status)) {
            inTesting += 1;
        }
    }

    return input.mode === 'testing'
        ? { primary: inTesting, secondary: inDevelopment }
        : { primary: inDevelopment, secondary: inTesting };
}

/**
 * GitLab：待我审 = 审查队列长度（含审批取数失败的，宁可多提示）；
 * 我的 MR 等别人审 = 我提交且尚未被其他人批准（reviewed 之外都算）。
 */
export function countMrBadges(reviewQueue: MrCard[], myMrs: MrCard[], mode: MrBadgeMode): BadgeCounts {
    const awaitingMe = reviewQueue.length;
    const awaitingOthers = myMrs.filter((card) => card.reviewState !== 'reviewed').length;

    return mode === 'awaitingOthers'
        ? { primary: awaitingOthers, secondary: awaitingMe }
        : { primary: awaitingMe, secondary: awaitingOthers };
}
