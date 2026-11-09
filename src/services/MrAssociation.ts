import type { MrFact } from '../models/Board';
import type { GitLabMr } from './GitLabService';
import { extractJiraKeys } from './JiraKeyMatcher';

export interface AssociatedMr {
    mr: GitLabMr;
    matchedBy: 'title' | 'description' | 'branch';
    key: string;
}

/**
 * MR → Jira key 的关联。
 *
 * 顺序是标题 → 描述 → 源分支：实测分支名多为裸编号（`bug-891` / `task-932`），
 * 完整 key 几乎总在标题里。一个 MR 可能覆盖多个 key（`NEX2-1038+1039`），
 * 一个 key 也可能挂多个 MR，都是常态。
 */
export function associateMrs(mrs: GitLabMr[], projects: string[]): Map<string, AssociatedMr[]> {
    const byKey = new Map<string, AssociatedMr[]>();

    for (const mr of mrs) {
        const fromTitle = extractJiraKeys(mr.title, projects);
        const fromDescription = fromTitle.length > 0 ? [] : extractJiraKeys(mr.description, projects);
        const fromBranch =
            fromTitle.length > 0 || fromDescription.length > 0
                ? []
                : extractJiraKeys(mr.sourceBranch, projects);

        const matchedBy = fromTitle.length > 0 ? 'title' : fromDescription.length > 0 ? 'description' : 'branch';
        const keys = fromTitle.length > 0 ? fromTitle : fromDescription.length > 0 ? fromDescription : fromBranch;

        for (const key of keys) {
            const list = byKey.get(key) ?? [];
            list.push({ mr, matchedBy, key });
            byKey.set(key, list);
        }
    }

    return byKey;
}

/** 转成给 WebView 的事实形状，并按阶段排序（merged 的排在前面，便于详情浮层高亮） */
export function toMrFacts(associated: AssociatedMr[]): MrFact[] {
    const ordered = [...associated].sort((left, right) => {
        const stateDiff = stateWeight(right.mr.state) - stateWeight(left.mr.state);
        if (stateDiff !== 0) {
            return stateDiff;
        }
        const leftTime = left.mr.mergedAt ? Date.parse(left.mr.mergedAt) : 0;
        const rightTime = right.mr.mergedAt ? Date.parse(right.mr.mergedAt) : 0;
        return rightTime - leftTime || right.mr.iid - left.mr.iid;
    });

    return ordered.map(({ mr, matchedBy }) => ({
        iid: mr.iid,
        title: mr.title,
        state: mr.state,
        url: mr.webUrl,
        targetBranch: mr.targetBranch,
        sourceBranch: mr.sourceBranch,
        approved: false,
        approvedBy: [],
        approvalsLeft: null,
        // merged / closed 不查审批；opened 由 BoardState 按 /approvals 结果覆盖
        approvalsKnown: mr.state !== 'opened',
        mergedAt: mr.mergedAt,
        mergeCommitSha: mr.mergeCommitSha,
        matchedBy,
        isCardMr: false,
    }));
}

function stateWeight(state: string): number {
    if (state === 'merged') {
        return 3;
    }
    if (state === 'opened') {
        return 2;
    }
    return 1;
}
