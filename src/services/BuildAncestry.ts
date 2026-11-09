import type { BuildFact, MrFact } from '../models/Board';
import { GitLabService } from './GitLabService';

/**
 * 「这次构建的代码树里有没有这个合入」——用祖先关系判，不用时间窗。
 *
 * 判定方式：`merge_base(合入的 merge commit, 构建 SHA) === 合入的 merge commit`。
 * 相等说明合入是构建 SHA 的祖先（或就是它自己）。
 *
 * 三态：true / false / null。null 不是 false——取不到 SHA、没有公共祖先、
 * 接口失败都归 null，调用方必须退回时间窗并把结论标成「推断」。
 */
export type Containment = boolean | null;

/** 同一对 SHA 的答案不会变，进程内缓存起来；键含仓库，跨仓库不串 */
const mergeBaseCache = new Map<string, Promise<string>>();

export function containmentKey(mr: MrFact, build: BuildFact): string {
    return `${mr.iid}@${build.number}`;
}

function newestFirst(left: BuildFact, right: BuildFact): number {
    return right.timestamp - left.timestamp || right.number - left.number;
}

/**
 * 一轮只需要问两次祖先关系：最新成功构建（判「已构建」）与最新已完成构建（判高风险）。
 * 把 20 次构建 × N 张卡 的全量笛卡尔积压到 2 × N，首次加载才不至于卡住。
 */
export function buildsWorthChecking(builds: BuildFact[]): BuildFact[] {
    const latestSuccess = builds.filter((build) => build.result === 'SUCCESS').sort(newestFirst)[0];
    const latestFinished = builds.filter((build) => build.result !== null).sort(newestFirst)[0];
    const picked = [latestSuccess, latestFinished].filter((build): build is BuildFact => build !== undefined);
    return [...new Map(picked.map((build) => [build.number, build])).values()];
}

/**
 * 本次失败构建「新引入」的合入数：在失败构建的树里，但不在上一次成功构建的树里。
 * 这个数字只描述范围，不断定因果。
 */
export function newlyIntroducedCount(
    mrs: MrFact[],
    builds: BuildFact[],
    containment: Map<string, Containment>
): number {
    const latestSuccess = builds.filter((build) => build.result === 'SUCCESS').sort(newestFirst)[0];
    const latestFailure = builds.filter((build) => build.result === 'FAILURE').sort(newestFirst)[0];
    if (!latestFailure) {
        return 0;
    }

    const counted = new Set<string>();
    for (const mr of mrs) {
        if (!mr.mergeCommitSha) {
            continue;
        }
        const inFailure = containment.get(containmentKey(mr, latestFailure)) === true;
        const inSuccess = latestSuccess ? containment.get(containmentKey(mr, latestSuccess)) === true : false;
        if (inFailure && !inSuccess) {
            counted.add(mr.mergeCommitSha);
        }
    }
    return counted.size;
}

async function mergeBaseOf(
    gitlab: Pick<GitLabService, 'getMergeBase'>,
    project: string,
    left: string,
    right: string
): Promise<string | null> {
    const key = `${project}|${left}|${right}`;
    const cached = mergeBaseCache.get(key);
    if (cached) {
        return cached.catch(() => null);
    }
    const promise = gitlab.getMergeBase(project, left, right);
    mergeBaseCache.set(key, promise);
    try {
        return await promise;
    } catch (error) {
        // 失败不留在缓存里，下一轮还能重试
        if (mergeBaseCache.get(key) === promise) {
            mergeBaseCache.delete(key);
        }
        console.warn(`[jira-board] merge_base 判定失败（${left.slice(0, 8)}…${right.slice(0, 8)}）`, error);
        return null;
    }
}

/** 单个判定：构建树是否包含合入 */
export async function buildContainsMerge(
    gitlab: Pick<GitLabService, 'getMergeBase'>,
    project: string,
    mergeSha: string,
    buildSha: string
): Promise<Containment> {
    const base = await mergeBaseOf(gitlab, project, mergeSha, buildSha);
    if (base === null) {
        return null;
    }
    return base.toLowerCase() === mergeSha.toLowerCase();
}

/**
 * 一轮取数里所有（合入, 构建）对的判定结果。
 * 只算「已合入且有 merge commit」的 MR 与「拿得到 SHA」的构建；
 * 其余组合不出现在 map 里，resolver 会当作 unknown 退回时间窗。
 */
export async function resolveContainment(input: {
    gitlab: Pick<GitLabService, 'getMergeBase'>;
    project: string;
    mrs: MrFact[];
    builds: BuildFact[];
}): Promise<Map<string, Containment>> {
    const pairs: Array<{ mr: MrFact; build: BuildFact }> = [];
    const seen = new Set<string>();

    for (const mr of input.mrs) {
        if (mr.state !== 'merged' || !mr.mergeCommitSha) {
            continue;
        }
        for (const build of input.builds) {
            if (!build.sha) {
                continue;
            }
            const dedupe = `${mr.mergeCommitSha}|${build.sha}`;
            if (seen.has(dedupe)) {
                continue;
            }
            seen.add(dedupe);
            pairs.push({ mr, build });
        }
    }

    if (pairs.length === 0) {
        return new Map();
    }

    const results = await GitLabService.mapWithLimit(pairs, 4, (pair) =>
        buildContainsMerge(input.gitlab, input.project, pair.mr.mergeCommitSha!, pair.build.sha!)
    );

    // 同一对（合入, 构建 SHA）可能被多次构建复用，先按 SHA 对归并再回填到每张卡
    const byShas = new Map<string, Containment>();
    pairs.forEach((pair, index) => {
        byShas.set(`${pair.mr.mergeCommitSha}|${pair.build.sha}`, results[index]);
    });

    const map = new Map<string, Containment>();
    for (const mr of input.mrs) {
        if (!mr.mergeCommitSha) {
            continue;
        }
        for (const build of input.builds) {
            if (!build.sha) {
                continue;
            }
            const verdict = byShas.get(`${mr.mergeCommitSha}|${build.sha}`);
            if (verdict !== undefined) {
                map.set(containmentKey(mr, build), verdict);
            }
        }
    }
    return map;
}
