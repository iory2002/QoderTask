import { useEffect } from 'preact/hooks';

import type { MrCard } from '../../src/models/MrBoard';
import { shortRepo } from './MrCard';

export function MrDetailPanel({
    card,
    perspective,
    onClose,
    onOpenGitLab,
    onReview,
    onOpenJira,
}: {
    card: MrCard;
    perspective: 'review-queue' | 'my-mrs';
    onClose: () => void;
    onOpenGitLab: (url: string) => void;
    onReview: (card: MrCard) => void;
    onOpenJira: (key: string) => void;
}) {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [card.iid, onClose]);

    return (
        <>
            <div class="detail-backdrop" onClick={onClose} />
            <aside class="detail" role="dialog" aria-label={`MR !${card.iid} 详情`}>
                <div class="dlg-head">
                    <span class="mr-iid">!{card.iid}</span>
                    <span class="hint">{shortRepo(card.projectPath)}</span>
                    <div class="spacer" />
                    <button class="btn" onClick={onClose} title="关闭（Esc）">
                        关闭
                    </button>
                </div>

                <div class="dlg-body">
                    <div class="title" style="cursor:auto">
                        {card.title}
                    </div>

                    <div class="fact">
                        <dl>
                            <dt>审查状态</dt>
                            <dd>{describeState(card)}</dd>
                            <dt>作者</dt>
                            <dd>{card.author.name || card.author.username}</dd>
                            <dt>批准人</dt>
                            <dd>{describeApprovers(card)}</dd>
                            <dt>合并冲突</dt>
                            <dd class={card.hasConflicts === true ? 'fact-bad' : undefined}>
                                {describeConflicts(card)}
                            </dd>
                            <dt>未解决讨论</dt>
                            <dd>{describeDiscussions(card)}</dd>
                            <dt>分支</dt>
                            <dd>
                                {card.sourceBranch} → {card.targetBranch}
                            </dd>
                            <dt>仓库</dt>
                            <dd>{card.projectPath}</dd>
                            <dt>创建时间</dt>
                            <dd>{formatTime(card.createdAt)}</dd>
                            <dt>更新时间</dt>
                            <dd>{formatTime(card.updatedAt)}</dd>
                            <dt>Jira</dt>
                            <dd>
                                {card.jiraKeys.length === 0
                                    ? '无'
                                    : card.jiraKeys.map((key) => (
                                          <a
                                              class="key mr-key"
                                              href="#"
                                              key={key}
                                              onClick={(event) => {
                                                  event.preventDefault();
                                                  onOpenJira(key);
                                              }}
                                          >
                                              {key}
                                          </a>
                                      ))}
                            </dd>
                        </dl>
                    </div>
                </div>

                <div class="dlg-foot">
                    {perspective === 'review-queue' ? (
                        <button class="btn primary" onClick={() => onReview(card)}>
                            用 Qoder 审查此 MR
                        </button>
                    ) : null}
                    <button class="btn gitlab" onClick={() => onOpenGitLab(card.url)}>
                        在 GitLab 中打开
                    </button>
                </div>
            </aside>
        </>
    );
}

function describeState(card: MrCard): string {
    switch (card.reviewState) {
        case 'awaiting-me':
            return '待我审';
        case 'reviewed':
            return `已审（${card.approvedBy.length} 人）`;
        case 'unreviewed':
            return '未审';
        case 'unknown':
            return '审批未知（/approvals 取数失败）';
    }
}

function describeApprovers(card: MrCard): string {
    if (!card.approvalsKnown) {
        return '取数失败，无法判断';
    }
    if (card.approvedBy.length === 0) {
        return '还没有人批准';
    }
    const names = card.approvedBy.map((person) => person.name || person.username).join('、');
    return card.approvalsLeft ? `${names}（还差 ${card.approvalsLeft} 个批准）` : names;
}

function describeConflicts(card: MrCard): string {
    if (card.hasConflicts === true) {
        return '有冲突，需要先解决';
    }
    if (card.hasConflicts === false) {
        return '无冲突';
    }
    return '未知（列表接口未返回）';
}

function describeDiscussions(card: MrCard): string {
    if (card.blockingDiscussionsResolved === false) {
        return '还有未解决的讨论';
    }
    if (card.blockingDiscussionsResolved === true) {
        return '讨论已全部解决';
    }
    // 条数需要额外请求 /discussions；这张票不允许新增请求，所以只能说到「有没有」
    return '未知（列表接口未返回）';
}

function formatTime(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleString();
}
