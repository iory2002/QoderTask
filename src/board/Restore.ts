import type { BoardCard, BoardColumn, Freshness } from '../models/Board';
import type { MrCandidate } from '../services/MrBoardResolver';
import type { GitLabApprovals, GitLabMr } from '../services/GitLabService';
import type { ApprovalRow, IssueRow, MrRow } from './FactStore';

/**
 * 事实库 → 看板输入。
 *
 * 这里只做「形状转换」：把库里的整数与空值还原成取数时的那套事实，
 * 阶段、角标、推导依据仍然由 `resolveStage` / `classify` 现算。
 */

/** 库里存 epoch ms；取数链路用 ISO 字符串，转换只发生在这一处 */
export function isoTimestamp(epoch: number | null): string | undefined {
    return epoch === null ? undefined : new Date(epoch).toISOString();
}

export function cardFromIssue(
    row: IssueRow,
    columns: BoardColumn[],
    viewerName: string | null,
    urlOf: (key: string) => string
): BoardCard {
    return {
        key: row.key,
        project: row.project,
        summary: row.summary,
        issueType: row.type,
        priority: row.priority,
        statusId: row.statusId,
        statusName: row.statusName,
        columnName: columns.find((column) => column.statusIds.includes(row.statusId))?.name ?? '',
        epicKey: row.epicKey,
        epicLabel: row.epicKey,
        rank: row.rank ?? '',
        assignee: row.assignee,
        isMine: viewerName !== null && row.assignee === viewerName,
        pinned: false,
        isSubtask: row.type.toLowerCase().includes('sub') || row.parentKey !== null,
        parentKey: row.parentKey ?? undefined,
        commentCount: row.commentCount,
        updatedAtEpoch: row.updatedAt,
        stage: null,
        buildFailed: false,
        buildChannel: 'none',
        mergedDaysAgo: null,
        mrs: [],
        evidence: [],
        url: urlOf(row.key),
    };
}

/** 库里的一行 MR → Jira 板用的 GitLabMr（description 不入库，用空串） */
export function gitLabMrsFromStore(rows: MrRow[]): GitLabMr[] {
    return rows.map((row) => ({
        iid: row.iid,
        state: row.state,
        targetBranch: row.targetBranch,
        sourceBranch: row.sourceBranch,
        title: row.title,
        description: '',
        mergedAt: isoTimestamp(row.mergedAt),
        mergeCommitSha: row.mergeCommitSha ?? undefined,
        webUrl: row.webUrl ?? '',
        updatedAt: isoTimestamp(row.updatedAt) ?? '',
        createdAt: isoTimestamp(row.createdAt),
        authorId: row.authorId ?? undefined,
        authorName: row.authorName ?? undefined,
        hasConflicts: row.hasConflicts,
        blockingDiscussionsResolved: row.blockingDiscussionsResolved,
    }));
}

/** 库里的一行 MR → MR 板的两列分类输入 */
export function mrCandidatesFromStore(rows: MrRow[]): MrCandidate[] {
    return rows.map((row) => ({
        projectPath: row.project,
        iid: row.iid,
        title: row.title,
        description: '',
        url: row.webUrl ?? '',
        state: row.state,
        sourceBranch: row.sourceBranch,
        targetBranch: row.targetBranch,
        author: { id: row.authorId ?? 0, name: row.authorName ?? '', username: '' },
        reviewerIds: row.reviewerIds,
        draft: row.draft,
        hasConflicts: row.hasConflicts,
        blockingDiscussionsResolved: row.blockingDiscussionsResolved,
        createdAt: isoTimestamp(row.createdAt) ?? '',
        updatedAt: isoTimestamp(row.updatedAt) ?? '',
    }));
}

/**
 * 审批行 → GitLabApprovals。
 * `approved` / `approvalsLeft` 来自 mr 表（服务端原话），没有就是未知。
 */
export function approvalsFromStore(approvalRows: ApprovalRow[], mr: MrRow): GitLabApprovals {
    const approvedAtById: Record<string, number | null> = {};
    const people = approvalRows.map((row) => {
        approvedAtById[String(row.userId)] = row.approvedAt;
        return { id: row.userId, name: row.userName ?? '', username: '' };
    });
    return {
        approved: mr.approved === true,
        approvalsLeft: mr.approvalsLeft,
        approvedBy: people.map((person) => person.name).filter(Boolean),
        approvedByIds: people.map((person) => person.id),
        approvedByPeople: people,
        approvedAtById,
    };
}

/** 库里恢复出来的数据一定是「上一次成功」的快照，先按过期展示，等网络刷新覆盖 */
export function restoredFreshness(lastSuccessAt: number | null): Freshness {
    if (lastSuccessAt === null) {
        return { lastSuccessAt: null, stale: false, error: null };
    }
    return { lastSuccessAt, stale: true, error: null };
}
