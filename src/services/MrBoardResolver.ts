import type { MrCard, MrPerson, MrReviewState } from '../models/MrBoard';
import type { GitLabApprovals } from './GitLabService';
import { extractJiraKeys } from './JiraKeyMatcher';
import { epochOrZero } from './time';

/** 列表接口归一化后的一行事实（两个仓库可能有同号 MR，key 必须带仓库） */
export interface MrCandidate {
    projectPath: string;
    iid: number;
    title: string;
    description: string;
    url: string;
    state: string;
    sourceBranch: string;
    targetBranch: string;
    author: MrPerson;
    reviewerIds: number[];
    draft: boolean;
    /** null = 列表接口没返回这个字段；不能当 false */
    hasConflicts: boolean | null;
    blockingDiscussionsResolved: boolean | null;
    createdAt: string;
    updatedAt: string;
}

export interface ClassifyInput {
    candidates: MrCandidate[];
    viewerId: number;
    /** key = mrKey(projectPath, iid) */
    approvals: Map<string, GitLabApprovals | undefined>;
    /** Jira key 白名单：与 Jira 看板一致，长 key 由 matcher 自己排序 */
    jiraProjects: string[];
    /**
     * 由 reviewer 查询返回的 key 列表（可选）。
     * 用于诊断「服务端 reviewer_id 参数被忽略」：本地复核掉的条数会记进 unseenCount。
     */
    reviewerQueryKeys?: string[];
}

export interface ClassifyResult {
    reviewQueue: MrCard[];
    myMrs: MrCard[];
    closedCount: number;
    /** 诊断值：reviewer 查询返回、但本地复核发现我并不是 reviewer 的条数 */
    unseenCount: number;
}

export function mrKey(projectPath: string, iid: number): string {
    return `${projectPath}!${iid}`;
}

function isClosed(state: string): boolean {
    return state === 'closed';
}

function isOpened(state: string): boolean {
    return state === 'opened';
}

/** 标题 → 描述 → 源分支，与 Jira 看板的关联顺序一致 */
function jiraKeysOf(candidate: MrCandidate, projects: string[]): string[] {
    for (const text of [candidate.title, candidate.description, candidate.sourceBranch]) {
        const keys = extractJiraKeys(text, projects);
        if (keys.length > 0) {
            return keys;
        }
    }
    return [];
}

function reviewStateOf(
    candidate: MrCandidate,
    viewerId: number,
    approval: GitLabApprovals | undefined
): MrReviewState {
    if (approval === undefined) {
        return 'unknown';
    }
    const others = approval.approvedByIds.filter((id) => id !== viewerId);
    return others.length > 0 ? 'reviewed' : 'unreviewed';
}

function toCard(candidate: MrCandidate, approval: GitLabApprovals | undefined, state: MrReviewState, projects: string[]): MrCard {
    return {
        iid: candidate.iid,
        projectPath: candidate.projectPath,
        title: candidate.title,
        url: candidate.url,
        sourceBranch: candidate.sourceBranch,
        targetBranch: candidate.targetBranch,
        author: candidate.author,
        approvedBy: approval?.approvedByPeople ?? [],
        approvalsLeft: approval?.approvalsLeft ?? null,
        approvalsKnown: approval !== undefined,
        hasConflicts: candidate.hasConflicts,
        blockingDiscussionsResolved: candidate.blockingDiscussionsResolved,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
        reviewState: state,
        jiraKeys: jiraKeysOf(candidate, projects),
    };
}

function byUpdatedDesc(left: MrCard, right: MrCard): number {
    const diff = epochOrZero(right.updatedAt) - epochOrZero(left.updatedAt);
    if (diff !== 0) {
        return diff;
    }
    if (right.iid !== left.iid) {
        return right.iid - left.iid;
    }
    return right.projectPath.localeCompare(left.projectPath);
}

/**
 * 事实 → 两列卡片。纯函数：所有列归属、过滤、排序、去重都只在这里。
 *
 * 硬规则：
 * 1. 只收 opened；merged 不显示也不计数；closed 只计数；
 * 2. Draft 完全不可见；
 * 3. 队列 = reviewers 含我 且 我未批准；审批取不到时仍入列（宁可多显示）；
 * 4. 第二列只看 author = me，不看 assignee；
 * 5. 同号 MR 同时命中两列时只进队列。
 */
export function classify(input: ClassifyInput): ClassifyResult {
    const { viewerId, approvals, jiraProjects } = input;

    const seen = new Set<string>();
    const reviewQueue: MrCard[] = [];
    const myMrs: MrCard[] = [];
    let closedCount = 0;

    for (const candidate of input.candidates) {
        const key = mrKey(candidate.projectPath, candidate.iid);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);

        if (candidate.draft) {
            continue;
        }
        if (isClosed(candidate.state)) {
            closedCount += 1;
            continue;
        }
        if (!isOpened(candidate.state)) {
            continue;
        }

        const approval = approvals.get(key);
        const approvedByMe =
            approval !== undefined && approval.approvedByIds.some((id) => id === viewerId);
        const isReviewer = candidate.reviewerIds.includes(viewerId);
        // 审批取不到时不许把「我可能批过」当成「我批过」：留在队列里
        const belongsToQueue = isReviewer && (approval === undefined || !approvedByMe);

        if (belongsToQueue) {
            const state: MrReviewState = approval === undefined ? 'unknown' : 'awaiting-me';
            reviewQueue.push(toCard(candidate, approval, state, jiraProjects));
            continue;
        }

        if (candidate.author.id === viewerId) {
            myMrs.push(toCard(candidate, approval, reviewStateOf(candidate, viewerId, approval), jiraProjects));
        }
    }

    reviewQueue.sort(byUpdatedDesc);
    myMrs.sort(byUpdatedDesc);

    const unseen = input.reviewerQueryKeys ?? [];
    const unseenCount = unseen.filter((key) => {
        const candidate = input.candidates.find((entry) => mrKey(entry.projectPath, entry.iid) === key);
        return candidate !== undefined && !candidate.reviewerIds.includes(viewerId);
    }).length;

    return { reviewQueue, myMrs, closedCount, unseenCount };
}
