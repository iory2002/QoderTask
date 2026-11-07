import type { BoardCard } from '../../src/models/Board';

const STAGE_LABELS: Record<string, { text: string; cls: string }> = {
    none: { text: '未提交', cls: 's-none' },
    mr: { text: 'MR 待审', cls: 's-mr' },
    approved: { text: '已 Approve 待合入', cls: 's-appr' },
    merged: { text: '已合入待构建', cls: 's-merged' },
    built: { text: '已构建', cls: 's-built' },
    unknown: { text: '无法判定', cls: 's-unk' },
};

function typeClass(issueType: string): string {
    const type = issueType.toLowerCase();
    if (type.includes('bug')) {
        return 'bug';
    }
    if (type.includes('story')) {
        return 'story';
    }
    if (type.includes('sub')) {
        return 'subtask';
    }
    return 'task';
}

function initial(value: string): string {
    const trimmed = value.trim();
    return trimmed ? trimmed[0].toUpperCase() : '?';
}

export function Card({
    card,
    showAvatar,
    onOpenJira,
    onOpenDetail,
}: {
    card: BoardCard;
    showAvatar: boolean;
    onOpenJira: (key: string) => void;
    onOpenDetail: (key: string) => void;
}) {
    return (
        <article class="card" data-key={card.key} title={card.summary} onClick={() => onOpenDetail(card.key)}>
            <div class="row1">
                <span class={`type ${typeClass(card.issueType)}`} title={card.issueType}>
                    {initial(card.issueType)}
                </span>
                <a
                    class="key"
                    href={card.url}
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onOpenJira(card.key);
                    }}
                >
                    {card.key}
                </a>
                {card.isSubtask ? (
                    <span class="sub-badge" title={card.parentKey ? `父任务 ${card.parentKey}` : '子任务'}>
                        子
                    </span>
                ) : null}
                {showAvatar && card.assignee ? (
                    <span class="avatar" title={card.assignee}>
                        {initial(card.assignee)}
                    </span>
                ) : null}
            </div>
            <div class="title">{card.summary}</div>
            <div class="row2">
                {card.priority ? (
                    <span class={/low/i.test(card.priority) ? 'prio low' : 'prio'}>{card.priority}</span>
                ) : null}
                {card.epicLabel ? (
                    <span class="epic" title={card.epicKey ?? undefined}>
                        {card.epicLabel}
                    </span>
                ) : null}
                {card.commentCount > 0 ? <span class="cmt">💬 {card.commentCount}</span> : null}
            </div>
            <StageBadges card={card} />
        </article>
    );
}

export function StageBadges({ card }: { card: BoardCard }) {
    if (card.stage === null) {
        return null;
    }
    const label = STAGE_LABELS[card.stage] ?? STAGE_LABELS.unknown;
    const text =
        card.stage === 'merged' && card.buildChannel === 'merge-only' ? '已合入' : label.text;

    return (
        <div class="stages">
            <span class={`stage ${label.cls}`} title={card.evidence.join('\n')}>
                {text}
            </span>
            {card.buildFailed ? (
                <span class="stage s-fail" title="目标分支上最近一次构建失败">
                    Build failed
                </span>
            ) : null}
        </div>
    );
}
