import type { MrFact } from '../models/Board';
import type { GitLabMr } from './GitLabService';
import { extractJiraKeys } from './JiraKeyMatcher';

/** `commit` 是兜底来源：只在标题 / 描述 / 源分支都没有 key 时才会用到 */
export type MatchSource = 'title' | 'description' | 'branch' | 'commit';

export interface AssociatedMr {
    mr: GitLabMr;
    matchedBy: MatchSource;
    key: string;
}

/** 一个 MR 的 key 来源；null = 三个正文字段都没有 key */
function keySourceOf(
    mr: GitLabMr,
    projects: string[]
): { keys: string[]; matchedBy: MatchSource } | null {
    const fromTitle = extractJiraKeys(mr.title, projects);
    if (fromTitle.length > 0) {
        return { keys: fromTitle, matchedBy: 'title' };
    }
    const fromDescription = extractJiraKeys(mr.description, projects);
    if (fromDescription.length > 0) {
        return { keys: fromDescription, matchedBy: 'description' };
    }
    const fromBranch = extractJiraKeys(mr.sourceBranch, projects);
    if (fromBranch.length > 0) {
        return { keys: fromBranch, matchedBy: 'branch' };
    }
    return null;
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
        const source = keySourceOf(mr, projects);
        if (!source) {
            continue;
        }
        for (const key of source.keys) {
            const list = byKey.get(key) ?? [];
            list.push({ mr, matchedBy: source.matchedBy, key });
            byKey.set(key, list);
        }
    }

    return byKey;
}

/**
 * 提交标题（subject）里的 key，用作最后一个兜底来源。
 *
 * 只读第一行，并且跳过 merge / revert：
 * - 正文里提到 key 往往是「顺带提及」，拿它关联会把卡片错误地推到「已合入」；
 * - merge commit 的标题常带着被合入的分支名，revert 提交则意味着修复已被撤销。
 */
export function commitSubjectsToKeys(subjects: string[], projects: string[]): string[] {
    const found: string[] = [];
    for (const subject of subjects) {
        const line = (subject.split('\n')[0] ?? '').trim();
        if (!line || /^(merge|revert)\b/i.test(line)) {
            continue;
        }
        found.push(...extractJiraKeys(line, projects));
    }
    return [...new Set(found)];
}

/**
 * 一轮最多为多少个「三个字段都没 key」的 MR 补查提交。
 *
 * 每个 MR 要多打一次 `/merge_requests/:iid/commits`，所以只补最短的那批：
 * 最近更新过的 MR 最可能是当前 sprint 在等的交付。
 */
export const MAX_COMMIT_LOOKUPS = 12;

/** 缓存条数上限：键里带 MR 的 updatedAt，推了新提交就自然换键 */
const COMMIT_CACHE_LIMIT = 500;
const commitCache = new Map<string, string[]>();

async function subjectsOf(
    gitlabProject: string,
    mr: GitLabMr,
    fetchCommits: (iid: number) => Promise<string[]>
): Promise<string[]> {
    const cacheKey = mr.updatedAt ? `${gitlabProject}|${mr.iid}|${mr.updatedAt}` : '';
    const cached = cacheKey ? commitCache.get(cacheKey) : undefined;
    if (cached) {
        return cached;
    }
    const subjects = await fetchCommits(mr.iid);
    if (cacheKey) {
        if (commitCache.size >= COMMIT_CACHE_LIMIT) {
            // 简单的 FIFO：最早插入的那条先淘汰
            const oldest = commitCache.keys().next().value;
            if (oldest !== undefined) {
                commitCache.delete(oldest);
            }
        }
        commitCache.set(cacheKey, subjects);
    }
    return subjects;
}

export interface CommitAssocInput {
    /** 只用于缓存键，区分同名 iid 的不同仓库 */
    gitlabProject: string;
    jiraProjects: string[];
    mrs: GitLabMr[];
    fetchCommits: (iid: number) => Promise<string[]>;
    /** 取不到提交时只记日志，不影响其余 MR 的关联 */
    onError?: (mr: GitLabMr, error: unknown) => void;
    /** 测试用：默认 MAX_COMMIT_LOOKUPS */
    maxLookups?: number;
    /** 测试用：默认 4 */
    concurrency?: number;
}

/**
 * 三个正文字段优先；都没命中时才补查提交标题。
 *
 * 这个顺序很重要：标题已经点名了某个 issue 的 MR 不会再去读提交，
 * 所以「一个 MR 修多张卡、但标题只写了一张」的老问题依然存在，
 * 提交兜底只救「标题 / 描述 / 分支一个字都没写」的 MR。
 */
export async function associateMrsIncludingCommits(
    input: CommitAssocInput
): Promise<Map<string, AssociatedMr[]>> {
    const byKey = associateMrs(input.mrs, input.jiraProjects);
    const candidates = input.mrs
        .filter((mr) => keySourceOf(mr, input.jiraProjects) === null)
        .sort((left, right) => (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0))
        .slice(0, Math.max(0, input.maxLookups ?? MAX_COMMIT_LOOKUPS));

    if (candidates.length === 0) {
        return byKey;
    }

    const concurrency = Math.max(1, input.concurrency ?? 4);
    let cursor = 0;
    const worker = async () => {
        while (cursor < candidates.length) {
            const mr = candidates[cursor];
            cursor += 1;
            try {
                const subjects = await subjectsOf(input.gitlabProject, mr, input.fetchCommits);
                for (const key of commitSubjectsToKeys(subjects, input.jiraProjects)) {
                    const list = byKey.get(key) ?? [];
                    list.push({ mr, matchedBy: 'commit', key });
                    byKey.set(key, list);
                }
            } catch (error) {
                input.onError?.(mr, error);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));

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
