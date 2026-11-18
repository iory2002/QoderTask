import type { BuildChannel, BuildFact, MrFact, Stage } from '../models/Board';
import { buildWindowOf, formatStamp } from '../board/buildTime';
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
    /**
     * containment 从哪来：'restored' = 从事实库恢复，本轮没联网问祖先关系。
     * 只影响推导依据的措辞，不影响结论。
     */
    containmentNote?: 'restored';
    /** 本次失败构建新引入的合入数（整个仓库口径），只用于详情描述 */
    newlyIntroduced?: number;
    /** Jira 状态名：只有「退回开发」的状态才会让本轮重新起算 */
    statusName?: string;
    /** 被视为「已退回开发 / 返工」的状态名；缺省用 DEFAULT_REWORK_STATUSES */
    reworkStatuses?: string[];
    /** 子任务继承：父任务的解析结果 */
    inherited?: { stage: Stage; buildFailed: boolean; evidence: string[]; mr?: MrFact; build?: BuildFact };
}

/**
 * 只有写代码的类型才需要看构建：Story 与 Bug（含 In-Sprint Bug 变体）。
 * Task / Sub-task 不走构建链路（它们是配置、测试用例、文档类工作），
 * 阶段顶格在「已合入」，否则它们会永远挂在「待构建」。
 */
export const DEFAULT_BUILD_CHECKED_TYPES = ['Story', 'Bug', 'In-Sprint Bug'];

export function buildChecksApplyTo(issueType: string, checkedTypes: string[] = DEFAULT_BUILD_CHECKED_TYPES): boolean {
    const normalized = issueType.trim().toLowerCase();
    return checkedTypes.some((type) => type.trim().toLowerCase() === normalized);
}

/** 名字带 Bug 的类型都算「写代码的工作」（包括作为子任务开出来的 In-Sprint Bug） */
export function isBugLikeType(issueType: string): boolean {
    return /bug/i.test(issueType.trim());
}

/**
 * 子任务是否继承父任务的阶段。
 *
 * 只适用于不写代码的子任务（配置、文档）。codeWork = 该类型算「写代码的工作」；
 * 测试退回后开出来的 In-Sprint Bug 属于本轮代码工作，必须按自己的 MR / 构建算，
 * 不能跟着 Story 显示父任务那一轮的「已构建」。
 */
export function inheritsParentStage(isSubtask: boolean, codeWork: boolean): boolean {
    return isSubtask && !codeWork;
}

export interface StageResult {
    stage: Stage | null;
    buildFailed: boolean;
    /** Jira 已退回开发：卡片显示「返工中」，上一轮的合入/构建不算本轮 */
    rework?: boolean;
    buildChannel: BuildChannel;
    /** 卡片上展示的那一个 MR（本轮最新的 MR） */
    cardMr?: MrFact;
    build?: BuildFact;
    evidence: string[];
}

/**
 * 本轮的主 MR：最新开出的那一个（同一个仓库里 iid 单调递增）。
 *
 * 不取「阶段最高」：返工时旧 MR 已合入并进了构建，新 MR 才是当前进度，
 * 取最高会让卡片一直停在「已构建」。已关闭且未合入的 MR 是放弃的尝试，
 * 只有在一个 opened / merged 都没有时才拿它兜底。
 */
export function pickCardMr(mrs: MrFact[]): MrFact | undefined {
    const active = mrs.filter((mr) => mr.state === 'opened' || mr.state === 'merged');
    const pool = active.length > 0 ? active : mrs;
    return [...pool].sort((left, right) => right.iid - left.iid)[0];
}

/** 默认视为「已退回开发 / 返工」的 Jira 状态名（大小写与首尾空格不敏感） */
export const DEFAULT_REWORK_STATUSES = ['In Progress', 'Reopened', 'In Rework', 'Test Failed'];

function matchesStatus(name: string | undefined, statuses: string[]): boolean {
    if (!name) {
        return false;
    }
    const wanted = name.trim().toLowerCase();
    return statuses.some((status) => status.trim().toLowerCase() === wanted);
}

/**
 * 事实 → 交付阶段。纯函数：输入卡片/MR/构建，输出阶段与推导依据。
 *
 * 阶梯（本轮最新 MR 的最高已达成者）：
 *   已构建 > 已合入待构建 > 已 Approve 待合入 > MR 待审 > 未提交
 * 取数失败 = 无法判定，绝不降级成「未提交」。
 * 返工（Jira 退回开发）是另一根轴：见 applyReworkRound。
 */
export function resolveStage(input: StageInput): StageResult {
    return applyReworkRound(input, resolveStageCore(input));
}

/**
 * 状态退回开发后，上一轮的「已构建」不能再代表本轮。
 *
 * 只在本轮还没有更新的 MR、且上一轮确实已构建时降回「返工中」：
 * - 有新 MR：新 MR 就是本轮的进度，按它算（MR 待审 / 已合入待构建 / 已构建）；
 * - 上一轮只是合入、还没构建：可能正在等构建，保持「已合入待构建」。
 *
 * 状态判定放在这里而不是阶梯里：阶段是代码事实（单调），返工是另一根轴。
 */
function applyReworkRound(input: StageInput, result: StageResult): StageResult {
    if (!matchesStatus(input.statusName, input.reworkStatuses ?? DEFAULT_REWORK_STATUSES)) {
        return result;
    }
    const delivered = input.mrs
        .filter((mr) => mr.state === 'merged')
        .sort((left, right) => right.iid - left.iid)[0];
    if (!delivered) {
        return result;
    }
    const newerRound = input.mrs.some(
        (mr) => mr.iid > delivered.iid && (mr.state === 'opened' || mr.state === 'merged')
    );
    if (newerRound || result.stage !== 'built') {
        return { ...result, rework: true };
    }
    return {
        ...result,
        stage: 'none',
        cardMr: result.cardMr ?? delivered,
        rework: true,
        evidence: [
            `Jira 状态「${input.statusName}」已退回开发：本轮从「未提交」重新起算`,
            '本轮还没有新的 MR；上一轮的合入 / 构建只作为历史记录',
            ...result.evidence,
        ],
    };
}

function resolveStageCore(input: StageInput): StageResult {
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
        cardMr.matchedBy === 'title'
            ? '标题'
            : cardMr.matchedBy === 'description'
              ? '描述'
              : cardMr.matchedBy === 'commit'
                ? '提交标题'
                : '分支名';
    evidence.push(`MR !${cardMr.iid}（${cardMr.state}，靠${source}关联）→ 目标分支 ${cardMr.targetBranch}`);
    const earlier = input.mrs.filter((mr) => mr.iid < cardMr.iid).length;
    if (earlier > 0) {
        evidence.push(`另有 ${earlier} 个更早的 MR（历史轮次，不参与本轮阶段）`);
    }

    if (cardMr.state === 'merged') {
        const mergedAt = epochOrZero(cardMr.mergedAt);
        evidence.push(`合入时间 ${formatStamp(cardMr.mergedAt, true) ?? '未知'}`);

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
        const newestFirst = (left: BuildFact, right: BuildFact) =>
            right.timestamp - left.timestamp || right.number - left.number;
        const latestSuccess = input.builds.filter((build) => build.result === 'SUCCESS').sort(newestFirst)[0];
        const lastFinished = input.builds.filter((build) => build.result !== null).sort(newestFirst)[0];
        const latestFailure = lastFinished?.result === 'FAILURE' ? lastFinished : undefined;

        const successVerdict = latestSuccess
            ? input.containment?.get(containmentKey(cardMr, latestSuccess))
            : undefined;
        const failureVerdict = latestFailure
            ? input.containment?.get(containmentKey(cardMr, latestFailure))
            : undefined;

        if (latestSuccess && successVerdict === true) {
            evidence.push(
                `最新成功构建 #${latestSuccess.number}，${buildWindowOf(latestSuccess)}，包含本次合入`
            );
            return { stage: 'built', buildFailed: false, buildChannel: channel, cardMr, build: latestSuccess, evidence };
        }

        // 高风险：从未被成功构建包含过，而最新已完成构建又确实包含它并失败了。
        // 两个「确实」缺一不可：拿不到祖先关系就不标，否则分支一红整板都是红字。
        // 有成功构建但「是否包含」判不出来时，同样不许标。
        const neverBuilt = latestSuccess === undefined || successVerdict === false;
        if (latestFailure && failureVerdict === true && neverBuilt) {
            evidence.push(`最新已完成构建 #${latestFailure.number} FAILURE，${buildWindowOf(latestFailure)}`);
            evidence.push(`本次构建新引入的合入共 ${input.newlyIntroduced ?? 0} 个；不断定是它引起的`);
            return {
                stage: 'merged',
                buildFailed: true,
                buildChannel: channel,
                cardMr,
                build: latestFailure,
                evidence,
            };
        }

        if (latestSuccess && successVerdict === false) {
            evidence.push(
                `最新成功构建 #${latestSuccess.number}，${buildWindowOf(latestSuccess)}，不含本次合入，等下一次成功构建`
            );
            return { stage: 'merged', buildFailed: false, buildChannel: channel, cardMr, build: latestSuccess, evidence };
        }

        if (latestSuccess) {
            // 拿不到 SHA / 祖先判定失败：退回时间窗，并说清是哪种「没判成」
            const inferred = latestSuccess.timestamp > mergedAt;
            const why =
                input.containmentNote === 'restored'
                    ? '本轮是事实库恢复，没有联网问祖先关系'
                    : '构建未提供 SHA 或祖先判定失败';
            evidence.push(
                `最新成功构建 #${latestSuccess.number}，${buildWindowOf(latestSuccess)}，${
                    inferred ? '晚于' : '早于'
                }合入时间（推断：${why}，只能按时间窗判断）`
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

        const running = input.builds.filter((build) => build.result === null && build.timestamp > mergedAt);
        if (running.length > 0) {
            evidence.push(
                `构建 #${running[0].number} 仍在进行中，${buildWindowOf(running[0])}，结果未知，不作为结论`
            );
        }
        if (lastFinished && lastFinished.timestamp > mergedAt) {
            evidence.push(
                `构建 #${lastFinished.number} ${lastFinished.result}，${buildWindowOf(
                    lastFinished
                )}，无法证明包含本次合入，不作为这张卡的问题`
            );
        } else {
            evidence.push('合入之后还没有任何已完成的构建');
        }

        return {
            stage: 'merged',
            buildFailed: false,
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
