import type { MrCard } from '../../src/models/MrBoard';

const BADGE: Record<MrCard['reviewState'], { text: string; cls: string }> = {
    'awaiting-me': { text: '待我审', cls: 's-mr' },
    reviewed: { text: '已审', cls: 's-appr' },
    unreviewed: { text: '未审', cls: 's-none' },
    unknown: { text: '审批未知', cls: 's-unk' },
};

export function shortRepo(projectPath: string): string {
    const parts = projectPath.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? projectPath;
}

/** 卡片上的时间只到分钟：精确到秒没有信息量，还会挤掉标题 */
export function shortTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function badgeOf(card: MrCard): { text: string; cls: string } {
    if (card.reviewState === 'reviewed') {
        return { text: `已审（${card.approvedBy.length} 人）`, cls: BADGE.reviewed.cls };
    }
    return BADGE[card.reviewState];
}

function peopleOf(card: MrCard): string {
    if (!card.approvalsKnown) {
        return '审批未知';
    }
    if (card.approvedBy.length === 0) {
        return '还没有人批准';
    }
    const names = card.approvedBy.map((person) => person.name || person.username).filter(Boolean);
    return names.slice(0, 2).join('、') + (names.length > 2 ? ` +${names.length - 2}` : '');
}

export function MrCardView({
    card,
    perspective,
    showRepo,
    onOpen,
    onMenu,
    onOpenJira,
}: {
    card: MrCard;
    perspective: 'review-queue' | 'my-mrs';
    showRepo: boolean;
    onOpen: (card: MrCard) => void;
    onMenu: (card: MrCard, perspective: 'review-queue' | 'my-mrs', x: number, y: number) => void;
    onOpenJira: (key: string) => void;
}) {
    const badge = badgeOf(card);

    return (
        <article
            class="card mr-card"
            data-iid={card.iid}
            title="单击看详情；右键更多操作"
            onClick={() => onOpen(card)}
            onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onMenu(card, perspective, event.clientX, event.clientY);
            }}
        >
            <div class="row1">
                <span class="mr-iid">!{card.iid}</span>
                {card.hasConflicts === true ? (
                    <span class="mr-conflict" title="有合并冲突，需要先解决">
                        有冲突
                    </span>
                ) : null}
                {showRepo ? (
                    <span class="mr-repo" title={card.projectPath}>
                        {shortRepo(card.projectPath)}
                    </span>
                ) : null}
                <span class="mr-updated">{shortTime(card.updatedAt)}</span>
            </div>

            <div class="title">{card.title}</div>

            <div class="row2">
                <span class="mr-person" title={perspective === 'review-queue' ? '提交者' : '批准人'}>
                    {perspective === 'review-queue' ? `作者 ${card.author.name || card.author.username}` : peopleOf(card)}
                </span>
                {card.jiraKeys.map((key) => (
                    <a
                        class="key mr-key"
                        href="#"
                        key={key}
                        title={`在 Jira 中打开 ${key}`}
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onOpenJira(key);
                        }}
                    >
                        {key}
                    </a>
                ))}
            </div>

            <div class="stages">
                <span class={`stage ${badge.cls}`}>{badge.text}</span>
                <span class="stage s-none" title={`${card.sourceBranch} → ${card.targetBranch}`}>
                    {card.targetBranch}
                </span>
            </div>
        </article>
    );
}
