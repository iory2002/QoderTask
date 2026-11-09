import type { BuildChannel, BuildFact, MrFact, Stage } from '../models/Board';
import { containmentKey, type Containment } from './BuildAncestry';
import { epochOrZero } from './time';

export interface StageInput {
    /** 该项目有 repo 条目 = 追踪；没有 = 不出徽章 */
    tracked: boolean;
    /** GitLab 取数是否成功；false 时必须是 unknown，不得降级成 none */
    dataOk: boolean;
    /** Jenkins 取数是否成功；只在「需要构建校验且已合入」时影响结论（默认 true） */
    buildsOk?: boolean;
    /** 该类型是否参与构建校验；Task / Sub-task 为 false，阶段顶格在已合入（默认 true） */
    buildChecked?: boolean;
    /** 只用于生成人话版的推导依据 */
    issueType?: string;
    buildChannel: BuildChannel;
    /** 已过滤 targetBranch、已关联到该 key 的 MR */
    mrs: MrFact[];
    /** 目标分支 job 上的构建，任意顺序 */
    builds: BuildFact[];
    /**
     * 已问过 GitLab 的祖先判定：key = containmentKey(mr, build)。
     * 缺失或 null = 未知，退回时间窗并标「推断」。
     */
    containment?: Map<string, Containment>;
    /** 子任务继承：父任务的解析结果 */
    inherited?: { stage: Stage; buildFailed: boolean; evidence: string[]; mr?: MrFact; build?: BuildFact };
}

/**
 * 只有写代码的类型才需要看构建：Story 与 Bug。
 * Task / Sub-task 不走构建链路（它们是配置、测试用例、文档类工作），
 * 阶段顶格在「已合入」，否则它们会永远挂在「待构建」。
 */
export const DEFAULT_BUILD_CHECKED_TYPES = ['Story', 'Bug'];

export function buildChecksApplyTo(issueType: string, checkedTypes: string[] = DEFAULT_BUILD_CHECKED_TYPES): boolean {
    const normalized = issueType.trim().toLowerCase();
    return checkedTypes.some((type) => type.trim().toLowerCase() === normalized);
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

/** 阶段最高者优先；同阶段取 merged_at 最新 */
export function pickCardMr(mrs: MrFact[]): MrFact | undefined {
    return [...mrs].sort((left, right) => {
        const diff = mrRank(right) - mrRank(left);
        if (diff !== 0) {
            return diff;
        }
        const mergedDiff = epochOrZero(right.mergedAt) - epochOrZero(left.mergedAt);
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
    const buildChecked = input.buildChecked !== false;
    const buildsOk = input.buildsOk !== false;
    // 不参与构建校验的类型，即使配了 job 也按「无构建通道」处理
    const channel: BuildChannel = input.buildChannel === 'full' && !buildChecked ? 'merge-only' : input.buildChannel;

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
            buildChannel: channel,
            evidence: ['GitLab / Jenkins 取数失败，无法判定阶段（不按「未提交」处理）'],
        };
    }

    if (input.mrs.length === 0) {
        if (input.inherited) {
            return {
                stage: input.inherited.stage,
                buildFailed: input.inherited.buildFailed,
                buildChannel: channel,
                cardMr: input.inherited.mr,
                build: input.inherited.build,
                evidence: ['子任务，继承父任务的阶段', ...input.inherited.evidence],
            };
        }
        return {
            stage: 'none',
            buildFailed: false,
            buildChannel: channel,
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
        const mergedAt = epochOrZero(cardMr.mergedAt);
        evidence.push(`合入时间 ${cardMr.mergedAt ?? '未知'}`);

        if (channel !== 'full') {
            evidence.push(
                !buildChecked
                    ? `该类型（${input.issueType ?? 'Task'}）不做构建校验，阶段顶格在「已合入」`
                    : channel === 'merge-only'
                      ? '该事项没有自动构建通道，阶段顶格在「已合入」'
                      : '未配置构建通道，阶段顶格在「已合入」'
            );
            return {
                stage: 'merged',
                buildFailed: false,
                buildChannel: channel,
                cardMr,
                evidence,
            };
        }

        if (!buildsOk) {
            // 构建是独立的一跳：取不到就不能假装「已合入」是最终结论
            evidence.push('Jenkins 取数失败，无法判定是否已构建（不按「已合入」处理）');
            return { stage: 'unknown', buildFailed: false, buildChannel: channel, cardMr, evidence };
        }

        // 「已构建」= 最新一次**成功**构建的代码树包含本次合入。
        // FAILURE 与进行中的构建都不算；同一 SHA 被多次构建时取最新那次。
        const latestSuccess = input.builds
            .filter((build) => build.result === 'SUCCESS')
            .sort((left, right) => right.timestamp - left.timestamp || right.number - left.number)[0];

        if (latestSuccess) {
            const verdict = input.containment?.get(containmentKey(cardMr, latestSuccess));
            const stamp = `#${latestSuccess.number}（开始于 ${formatTime(latestSuccess.timestamp)}）`;

            if (verdict === true) {
                evidence.push(`最新成功构建 ${stamp}包含本次合入`);
                return { stage: 'built', buildFailed: false, buildChannel: channel, cardMr, build: latestSuccess, evidence };
            }
            if (verdict === false) {
                evidence.push(`最新成功构建 ${stamp}不含本次合入，等下一次成功构建`);
                return { stage: 'merged', buildFailed: false, buildChannel: channel, cardMr, build: latestSuccess, evidence };
            }

            // 拿不到 SHA / 祖先判定失败：退回时间窗，并明说是推断
            const inferred = latestSuccess.timestamp > mergedAt;
            evidence.push(
                `最新成功构建 ${stamp}${inferred ? '晚于' : '早于'}合入时间` +
                    `（推断：构建未提供 SHA 或祖先判定失败，只能按时间窗判断）`
            );
            return {
                stage: inferred ? 'built' : 'merged',
                buildFailed: false,
                buildChannel: channel,
                cardMr,
                build: latestSuccess,
                evidence,
            };
        }

        const after = input.builds.filter((build) => build.timestamp > mergedAt);
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
            buildChannel: channel,
            cardMr,
            build: lastFinished,
            evidence,
        };
    }

    if (cardMr.state === 'opened') {
        if (!cardMr.approvalsKnown) {
            evidence.push('MR 仍开着，但 /approvals 取数失败，无法判断是否已批准');
            return { stage: 'unknown', buildFailed: false, buildChannel: input.buildChannel, cardMr, evidence };
        }
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
