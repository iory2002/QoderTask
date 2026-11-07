import type { BuildChannel, BuildFact, MrFact, Stage } from '../models/Board';

export interface StageInput {
    /** 该项目有 repo 条目 = 追踪；没有 = 不出徽章 */
    tracked: boolean;
    /** GitLab 取数是否成功；false 时必须是 unknown，不得降级成 none */
    dataOk: boolean;
    buildChannel: BuildChannel;
    /** 已过滤 targetBranch、已关联到该 key 的 MR */
    mrs: MrFact[];
    /** 目标分支 job 上的构建，任意顺序 */
    builds: BuildFact[];
    /** 子任务继承：父任务的解析结果 */
    inherited?: { stage: Stage; buildFailed: boolean; evidence: string[]; mr?: MrFact; build?: BuildFact };
}

export interface StageResult {
    stage: Stage | null;
    buildFailed: boolean;
    buildChannel: BuildChannel;
    /** 卡片上展示的那一个 MR（阶段最高；同阶段 merged_at 最新） */
    cardMr?: MrFact;
    build?: BuildFact;
    evidence: string[];
}

function mrRank(mr: MrFact): number {
    if (mr.state === 'merged') {
        return 3;
    }
    if (mr.state === 'opened') {
        return mr.approved ? 2 : 1;
    }
    return 0;
}

function timeOf(iso: string | undefined): number {
    if (!iso) {
        return 0;
    }
    const parsed = Date.parse(iso);
    return Number.isNaN(parsed) ? 0 : parsed;
}

/** 阶段最高者优先；同阶段取 merged_at 最新 */
export function pickCardMr(mrs: MrFact[]): MrFact | undefined {
    return [...mrs].sort((left, right) => {
        const diff = mrRank(right) - mrRank(left);
        if (diff !== 0) {
            return diff;
        }
        const mergedDiff = timeOf(right.mergedAt) - timeOf(left.mergedAt);
        if (mergedDiff !== 0) {
            return mergedDiff;
        }
        return right.iid - left.iid;
    })[0];
}

function formatTime(epochMs: number): string {
    const date = new Date(epochMs);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
        date.getMinutes()
    )}`;
}

/**
 * 事实 → 交付阶段。纯函数：输入卡片/MR/构建，输出阶段与推导依据。
 *
 * 阶梯（取最高已达成者）：
 *   已构建 > 已合入待构建 > 已 Approve 待合入 > MR 待审 > 未提交
 * 取数失败 = 无法判定，绝不降级成「未提交」。
 */
export function resolveStage(input: StageInput): StageResult {
    if (!input.tracked) {
        return {
            stage: null,
            buildFailed: false,
            buildChannel: 'none',
            evidence: ['该项目未配置 repo 条目，不追踪交付阶段'],
        };
    }

    if (!input.dataOk) {
        return {
            stage: 'unknown',
            buildFailed: false,
            buildChannel: input.buildChannel,
            evidence: ['GitLab / Jenkins 取数失败，无法判定阶段（不按「未提交」处理）'],
        };
    }

    if (input.mrs.length === 0) {
        if (input.inherited) {
            return {
                stage: input.inherited.stage,
                buildFailed: input.inherited.buildFailed,
                buildChannel: input.buildChannel,
                cardMr: input.inherited.mr,
                build: input.inherited.build,
                evidence: ['子任务，继承父任务的阶段', ...input.inherited.evidence],
            };
        }
        return {
            stage: 'none',
            buildFailed: false,
            buildChannel: input.buildChannel,
            evidence: ['标题、描述、源分支都没有关联到合入目标分支的 MR'],
        };
    }

    const cardMr = pickCardMr(input.mrs);
    if (!cardMr) {
        return { stage: 'unknown', buildFailed: false, buildChannel: input.buildChannel, evidence: [] };
    }

    const evidence: string[] = [];
    const source =
        cardMr.matchedBy === 'title' ? '标题' : cardMr.matchedBy === 'description' ? '描述' : '分支名';
    evidence.push(`MR !${cardMr.iid}（${cardMr.state}，靠${source}关联）→ 目标分支 ${cardMr.targetBranch}`);

    if (cardMr.state === 'merged') {
        const mergedAt = timeOf(cardMr.mergedAt);
        evidence.push(`合入时间 ${cardMr.mergedAt ?? '未知'}`);

        if (input.buildChannel !== 'full') {
            evidence.push(
                input.buildChannel === 'merge-only'
                    ? '该事项没有自动构建通道，阶段顶格在「已合入」'
                    : '未配置构建通道，阶段顶格在「已合入」'
            );
            return {
                stage: 'merged',
                buildFailed: false,
                buildChannel: input.buildChannel,
                cardMr,
                evidence,
            };
        }

        const after = input.builds.filter((build) => build.timestamp > mergedAt);
        const successes = after.filter((build) => build.result === 'SUCCESS');
        if (successes.length > 0) {
            const latest = successes.reduce((left, right) => (right.timestamp > left.timestamp ? right : left));
            evidence.push(
                `构建 #${latest.number} SUCCESS，开始于 ${formatTime(latest.timestamp)}（${latest.branch}），晚于合入时间`
            );
            return {
                stage: 'built',
                buildFailed: false,
                buildChannel: input.buildChannel,
                cardMr,
                build: latest,
                evidence,
            };
        }

        const running = after.filter((build) => build.result === null);
        if (running.length > 0) {
            evidence.push(`构建 #${running[0].number} 仍在进行中，结果未知，不作为结论`);
        }

        const finished = after
            .filter((build) => build.result !== null)
            .sort((left, right) => right.timestamp - left.timestamp);
        const lastFinished = finished[0];
        const failed = lastFinished !== undefined && lastFinished.result !== 'SUCCESS';
        if (failed) {
            evidence.push(
                `构建 #${lastFinished.number} ${lastFinished.result}，开始于 ${formatTime(
                    lastFinished.timestamp
                )}，未通过`
            );
        } else if (lastFinished === undefined) {
            evidence.push('合入之后还没有任何已完成的构建');
        }

        return {
            stage: 'merged',
            buildFailed: failed,
            buildChannel: input.buildChannel,
            cardMr,
            build: lastFinished,
            evidence,
        };
    }

    if (cardMr.state === 'opened') {
        if (cardMr.approved) {
            evidence.push(
                `已批准（approvals_left=${cardMr.approvalsLeft ?? 0}${
                    cardMr.approvedBy.length ? `，${cardMr.approvedBy.join('、')}` : ''
                }）`
            );
            return { stage: 'approved', buildFailed: false, buildChannel: input.buildChannel, cardMr, evidence };
        }
        evidence.push(
            `未批准（approvals_left=${cardMr.approvalsLeft ?? '未知'}${
                cardMr.approvedBy.length ? `，${cardMr.approvedBy.length} 人有审批记录但未达批准条件` : ''
            }）`
        );
        return { stage: 'mr', buildFailed: false, buildChannel: input.buildChannel, cardMr, evidence };
    }

    evidence.push('关联到的 MR 已关闭且未合入，按「未提交」处理');
    return { stage: 'none', buildFailed: false, buildChannel: input.buildChannel, cardMr, evidence };
}
