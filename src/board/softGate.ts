import type { BoardCard } from '../models/Board';

export interface GateCheck {
    /** true = 需要二次确认 */
    required: boolean;
    /** 缺什么，逐条列出 */
    items: string[];
    /** 仍然推进的后果说明 */
    consequence: string;
}

/**
 * 软闸门：推进到 In Test 前检查交付阶段。
 *
 * 闸门挂在「已合入」上，不挂在构建上——构建每天只跑两次、单次十几小时，
 * 卡在构建上会让用户永远推进不了。构建失败仍然列出来，但只是警告。
 * 未追踪阶段的项目（MAGR3 / IB，stage 为 null）没有可检查的事实，不弹闸门。
 */
export function checkSoftGate(card: BoardCard, targetColumnName: string): GateCheck {
    const isTestColumn = targetColumnName.trim().toLowerCase() === 'in test';
    if (!isTestColumn || card.stage === null) {
        return { required: false, items: [], consequence: '' };
    }

    const items: string[] = [];
    switch (card.stage) {
        case 'none':
            items.push('目标分支上还没有这张卡的合入记录');
            break;
        case 'mr':
            items.push('关联的 MR 还在待审，尚未合入目标分支');
            break;
        case 'approved':
            items.push('MR 已批准但还没有合入目标分支');
            break;
        case 'unknown':
            items.push('GitLab / Jenkins 取数失败，无法确认代码是否已合入');
            break;
        default:
            break;
    }

    if (card.buildFailed) {
        items.push(`构建未通过（${card.build ? `#${card.build.number}` : '最近一次构建失败'}）`);
    }

    return {
        required: items.length > 0,
        items,
        consequence: '仍然推进的话，这张卡在 Jira 里会变成「测试中」，而代码可能还没进目标分支。',
    };
}
