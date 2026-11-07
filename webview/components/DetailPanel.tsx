import { useEffect } from 'preact/hooks';

import type { BoardCard, BoardStatePayload } from '../../src/models/Board';
import { post } from '../api';

export function DetailPanel({
    card,
    state,
    onClose,
}: {
    card: BoardCard;
    state: BoardStatePayload;
    onClose: () => void;
}) {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [card.key, onClose]);

    return (
        <>
            <div class="detail-backdrop" onClick={onClose} />
            <aside class="detail" role="dialog" aria-label={`${card.key} 交付详情`}>
                <div class="dlg-head">
                    <a
                        class="key"
                        href={card.url}
                        onClick={(event) => {
                            event.preventDefault();
                            post({ type: 'card:openJira', payload: { key: card.key } });
                        }}
                    >
                        {card.key}
                    </a>
                    <span class="hint">{card.issueType}</span>
                    <div class="spacer" />
                    <button class="btn" onClick={onClose} title="关闭（Esc）">
                        关闭
                    </button>
                </div>

                <div class="dlg-body">
                    <div class="title" style="cursor:auto">{card.summary}</div>

                    <h4>阶段推导依据</h4>
                    {card.stage === null ? (
                        <div class="warn">
                            {card.project} 没有配置 repo 条目，这张卡不做阶段追踪（不是取数失败）。
                        </div>
                    ) : (
                        <ul class="evidence">
                            {card.evidence.length === 0 ? <li>没有可用的推导依据</li> : null}
                            {card.evidence.map((line, index) => (
                                <li key={index}>{line}</li>
                            ))}
                        </ul>
                    )}

                    <h4>关联的 MR（{card.mrs.length}）</h4>
                    {card.mrs.length === 0 ? (
                        <div class="hint">
                            {card.stage === 'unknown'
                                ? '取数失败，没有可展示的 MR 事实'
                                : '标题、描述、源分支都没有关联到合入目标分支的 MR'}
                        </div>
                    ) : (
                        card.mrs.map((mr) => (
                            <div class={mr.isCardMr ? 'fact highlight' : 'fact'} key={mr.iid}>
                                <dl>
                                    <dt>MR</dt>
                                    <dd>
                                        <a
                                            href={mr.url}
                                            onClick={(event) => {
                                                event.preventDefault();
                                                post({ type: 'board:openExternal', payload: { url: mr.url } });
                                            }}
                                        >
                                            !{mr.iid}
                                        </a>
                                        {mr.isCardMr ? ' · 卡片上展示的' : ''}
                                    </dd>
                                    <dt>标题</dt>
                                    <dd>{mr.title}</dd>
                                    <dt>状态</dt>
                                    <dd>
                                        {mr.state}
                                        {mr.state === 'opened' ? (mr.approved ? ' · 已批准' : ' · 未批准') : ''}
                                    </dd>
                                    <dt>批准人</dt>
                                    <dd>
                                        {mr.state === 'opened'
                                            ? mr.approvedBy.length > 0
                                                ? `${mr.approvedBy.join('、')}${
                                                      mr.approvalsLeft ? `（还差 ${mr.approvalsLeft} 个批准）` : ''
                                                  }`
                                                : '还没有人批准'
                                            : '未查（只对 opened 的 MR 查审批）'}
                                    </dd>
                                    <dt>关联来源</dt>
                                    <dd>{describeSource(mr.matchedBy)}</dd>
                                    {mr.mergedAt ? (
                                        <>
                                            <dt>合入时间</dt>
                                            <dd>{mr.mergedAt}</dd>
                                        </>
                                    ) : null}
                                    <dt>分支</dt>
                                    <dd>
                                        {mr.sourceBranch} → {mr.targetBranch}
                                    </dd>
                                </dl>
                            </div>
                        ))
                    )}

                    {card.build ? (
                        <>
                            <h4>构建</h4>
                            <div class="fact">
                                <dl>
                                    <dt>构建号</dt>
                                    <dd>
                                        <a
                                            href={card.build.url}
                                            onClick={(event) => {
                                                event.preventDefault();
                                                post({ type: 'board:openExternal', payload: { url: card.build!.url } });
                                            }}
                                        >
                                            #{card.build.number}
                                        </a>
                                    </dd>
                                    <dt>结果</dt>
                                    <dd>{card.build.result ?? '进行中'}</dd>
                                    <dt>开始时间</dt>
                                    <dd>{new Date(card.build.timestamp).toLocaleString()}</dd>
                                    <dt>分支</dt>
                                    <dd>{card.build.branch}</dd>
                                </dl>
                            </div>
                        </>
                    ) : null}

                    <h4>看板事实</h4>
                    <div class="fact">
                        <dl>
                            <dt>状态</dt>
                            <dd>{card.columnName || `列外状态（statusId=${card.statusId}）`}</dd>
                            <dt>经办人</dt>
                            <dd>{card.assignee ?? '未指派'}</dd>
                            <dt>Epic</dt>
                            <dd>{card.epicLabel ? `${card.epicLabel}（${card.epicKey}）` : '无'}</dd>
                            <dt>Rank</dt>
                            <dd>{card.rank || '无'}</dd>
                        </dl>
                    </div>
                </div>

                <div class="dlg-foot">
                    {state.scope.onlyMine ? null : (
                        <span class="hint" style="margin-right:auto">
                            头像与经办人只在「只看我的」关闭时显示
                        </span>
                    )}
                    <button
                        class="btn primary"
                        onClick={() => post({ type: 'card:openJira', payload: { key: card.key } })}
                    >
                        在 Jira 中打开
                    </button>
                </div>
            </aside>
        </>
    );
}

function describeSource(matchedBy: 'title' | 'description' | 'branch'): string {
    if (matchedBy === 'title') {
        return '标题里含这个 key';
    }
    if (matchedBy === 'description') {
        return '标题没有 key，描述里有';
    }
    return '标题与描述都没有 key，靠源分支名关联';
}
