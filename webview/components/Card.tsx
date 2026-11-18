import { REWORK_BADGE, STAGE_BADGES, stageBadgeText } from '../../src/board/stageFilter';
import type { BoardCard, CardDensity } from '../../src/models/Board';

/**
 * 优先级沿用 Jira 自己的 classic 图标（Blocker / Critical / Major / Minor / Trivial）。
 * 图片是 media/icons/priorities/ 下的 16×16 PNG，由 board.css 按类名挂背景图。
 * 认不出的名字（别的项目自定义了优先级方案）退回原来的文字，不猜颜色。
 */
const PRIORITY_ICONS = ['blocker', 'critical', 'major', 'minor', 'trivial'];

function priorityIcon(priority: string): string | null {
    const name = priority.trim().toLowerCase();
    return PRIORITY_ICONS.includes(name) ? name : null;
}

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
    density,
    showStage,
    showAvatar,
    onOpenJira,
    onOpenDetail,
    onOpenBuild,
}: {
    card: BoardCard;
    density: CardDensity;
    /** 没有 GitLab 凭据时整块不渲染：阶段徽章与构建失败徽章都是噪声 */
    showStage: boolean;
    showAvatar: boolean;
    onOpenJira: (key: string) => void;
    onOpenDetail: (key: string) => void;
    onOpenBuild: (url: string) => void;
}) {
    const compact = density === 'compact';
    const priority = card.priority ? priorityIcon(card.priority) : null;
    // 详细模式里徽章与 Epic 同在最后一行（徽章靠左、Epic 靠右）；
    // 精简模式卡片没有标题行，徽章直接贴在卡片右端。两处渲染的是同一个 StageBadges。
    const badges = showStage ? (
        <StageBadges card={card} compact={compact} onOpenBuild={onOpenBuild} />
    ) : null;
    // 优先级紧跟在类型后面，只在详细模式出现：精简版一行只保留类型、编号与阶段徽章。
    const priorityBadge = !compact && card.priority ? (
        priority ? (
            // 图标只剩形状，名称放进 title：悬停能看到 Jira 里的原始优先级名
            <span class={`prio-icon ${priority}`} title={card.priority} />
        ) : (
            <span class={/low/i.test(card.priority) ? 'prio low' : 'prio'}>{card.priority}</span>
        )
    ) : null;

    return (
        <article
            class={compact ? 'card compact' : 'card'}
            data-key={card.key}
            title={`${card.summary}\n\n单击卡片看交付详情；改状态请到 Jira`}
            onClick={() => onOpenDetail(card.key)}
        >
            <div class="card-main">
                <div class="row1">
                    <span class={`type ${typeClass(card.issueType)}`} title={card.issueType}>
                        {initial(card.issueType)}
                    </span>
                    {priorityBadge}
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
                    {/* 子任务标记与头像只在详细模式出现：精简版一行严格只有类型、编号与阶段徽章 */}
                    {!compact && card.isSubtask ? (
                        <span class="sub-badge" title={card.parentKey ? `父任务 ${card.parentKey}` : '子任务'}>
                            子
                        </span>
                    ) : null}
                    {!compact && showAvatar && card.assignee ? (
                        <span class="avatar" title={card.assignee}>
                            {initial(card.assignee)}
                        </span>
                    ) : null}
                </div>
                {compact ? null : (
                    <>
                        <div class="title">{card.summary}</div>
                        {/* 详细模式最后一行：状态徽章靠左、Epic 靠右（.epic 的 margin-left: auto）；
                            两者都没有就不渲染这一行，不留空白高度 */}
                        {badges || card.epicLabel ? (
                            <div class="row2">
                                {badges}
                                {card.epicLabel ? (
                                    // 只显示 Epic 名称；名称可能被 65% 宽度截断，悬停看全称
                                    <span class="epic" title={card.epicLabel}>
                                        {card.epicLabel}
                                    </span>
                                ) : null}
                            </div>
                        ) : null}
                    </>
                )}
            </div>
            {/* 精简模式卡片只有一行，徽章贴在右端 */}
            {compact ? badges : null}
        </article>
    );
}

export function StageBadges({
    card,
    compact,
    onOpenBuild,
}: {
    card: BoardCard;
    /** 精简模式用短名：一行里还要放构建失败徽章 */
    compact?: boolean;
    onOpenBuild: (url: string) => void;
}) {
    if (card.stage === null) {
        return null;
    }
    // Task / Sub-task 不产出 MR 是常态：没有 MR 时不报「未提交」，否则整列都是噪声
    if (card.stage === 'none' && card.codeWork === false && !card.rework) {
        return null;
    }
    // 返工中：本轮从零起算，文案与配色都用返工徽章
    const label = card.rework && card.stage === 'none' ? REWORK_BADGE : STAGE_BADGES[card.stage] ?? STAGE_BADGES.unknown;
    // 文案与「交付阶段」菜单共用 stageFilter：菜单里勾的名字就是卡片上显示的名字
    const text = stageBadgeText(card, compact === true);

    return (
        <div class="stages">
            <span class={`stage ${label.cls}`} title={card.evidence.join('\n')}>
                {text}
            </span>
            {card.buildFailed && card.build ? (
                // 只有「从未成功过 + 最新构建确实包含它」才走到这里；直达 Jenkins，不做复制。
                // 精简里也保留：构建失败是必须立刻看见的信号，只把文案压成 `✗ #N`。
                <a
                    class="stage s-fail"
                    href={card.build.url}
                    title={`构建失败 #${card.build.number}\n${card.build.url}\n${card.evidence.join('\n')}`}
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onOpenBuild(card.build!.url);
                    }}
                >
                    {compact ? `✗ #${card.build.number}` : `构建失败 #${card.build.number}`}
                </a>
            ) : null}
        </div>
    );
}
