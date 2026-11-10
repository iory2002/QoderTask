import * as fs from 'fs';

import type { BoardCard, BoardColumn, BuildFact } from '../models/Board';
import { DDL_V1, SCHEMA_VERSION } from './schema';

/**
 * 事实库：宿主内建的 `node:sqlite`，零依赖。
 *
 * 三条硬约束（来自 `.scratch/devops-board/research/` 的实测）：
 * 1. DatabaseSync 是同步 API，会阻塞扩展宿主 —— 事务要小、查询要有界；
 * 2. 写库失败绝不影响界面：方法返回 false，调用方继续用内存态；
 * 3. 事实与「上次成功时间」同一事务提交，失败时不得把旧数据标成新鲜。
 *
 * 派生状态（阶段、角标、推导依据）不落库，见 `columnsOf` 的单测。
 */

export interface SqliteStatement {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Array<Record<string, unknown>>;
}

export interface SqliteDatabase {
    exec(sql: string): void;
    prepare(sql: string): SqliteStatement;
    close(): void;
}

export interface SqliteModule {
    DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => SqliteDatabase;
}

export type StoreStatus = 'ok' | 'recovered' | 'readonly' | 'unavailable';

/** 库不可用时的统一说法：功能照常，只是退回单窗口 */
export const UNAVAILABLE_MESSAGE = '共享事实库不可用，已退回单窗口模式（多开窗口会各自取数）';

export interface OpenResult {
    store: FactStore | null;
    status: StoreStatus;
    /** 给板内提示用的人话；ok 时为 null */
    message: string | null;
}

/**
 * 迁移步骤：第 i 项把库从版本 i 推到 i+1。
 * 新增一版时往这里追加，并把 SCHEMA_VERSION 加一。
 */
const MIGRATIONS: Array<(db: SqliteDatabase) => void> = [(db) => db.exec(DDL_V1)];

/** 能力探测：宿主升级后 API 变了就返回 null，其余功能退回单窗口内存态 */
export function loadSqlite(): SqliteModule | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('node:sqlite') as Partial<SqliteModule>;
        return typeof mod?.DatabaseSync === 'function' ? (mod as SqliteModule) : null;
    } catch (error) {
        console.warn('[fact-store] 宿主没有 node:sqlite，退回单窗口内存态', error);
        return null;
    }
}

export interface IssueRow {
    key: string;
    project: string;
    sprintId: number | null;
    statusId: string;
    statusName: string;
    type: string;
    summary: string;
    priority: string | null;
    assignee: string | null;
    epicKey: string | null;
    parentKey: string | null;
    commentCount: number;
    rank: string | null;
    updatedAt: number | null;
}

export interface BuildRow {
    jobPath: string;
    number: number;
    result: string | null;
    startedAt: number;
    durationMs: number | null;
    sha: string | null;
    url: string | null;
}

export interface MrRow {
    project: string;
    iid: number;
    state: string;
    title: string;
    sourceBranch: string;
    targetBranch: string;
    authorId: number | null;
    authorName: string | null;
    createdAt: number | null;
    updatedAt: number | null;
    mergedAt: number | null;
    mergeCommitSha: string | null;
    draft: boolean;
    hasConflicts: boolean | null;
    blockingDiscussionsResolved: boolean | null;
    /** 列表接口返回的 reviewer id；MR 板恢复两列时要用 */
    reviewerIds: number[];
    webUrl: string | null;
    /** null = 没查过 /approvals（未知），不是「未批准」 */
    approved: boolean | null;
    approvalsLeft: number | null;
}

export interface ApprovalRow {
    project: string;
    iid: number;
    userId: number;
    userName: string | null;
    approvedAt: number | null;
}

export interface JiraSnapshot {
    boardId: number;
    columns: BoardColumn[];
    rankField: string;
    sprint: { id: number; name: string; state: string; startAt: number | null; endAt: number | null } | null;
    cards: BoardCard[];
}

export interface GitLabSnapshot {
    project: string;
    mrs: MrRow[];
    approvals: ApprovalRow[];
    /** 本轮**真正查过** /approvals 的 iid：只能删这些 MR 的审批，不能拿整条分支去删 */
    queriedApprovalIids: number[];
    /** MR → Jira key 的关联结果（事实，不是派生）；恢复时不必重新猜 */
    links: Array<{ iid: number; issueKey: string; matchedBy: string }>;
}

export interface LinkRow {
    iid: number;
    issueKey: string;
    matchedBy: string;
}

export interface ColumnRow {
    name: string;
    type: string;
}

export interface BoardRow {
    boardId: number;
    columns: BoardColumn[];
    rankField: string;
    fetchedAt: number;
}

export interface SprintRow {
    id: number;
    name: string;
    state: string;
}

export interface FetchStateRow {
    scope: string;
    lastSuccessAt: number | null;
    lastAttemptAt: number | null;
    attemptingUntil: number;
    owner: string | null;
    lastError: string | null;
}

/** 每个 job 只留最近 200 条构建：历史账本，不无限长 */
export const BUILD_RETENTION = 200;

/**
 * 多窗口协调的三个数字（与 `.scratch/devops-board/research/02` 一致）：
 * - 新鲜度 50s：比 60s 的轮询短一点，每拍都能看到「刚更新过」
 * - 占位 45s：覆盖一次全量 fetch 的最坏耗时
 * - 失败退避 15s：不锤同一台故障服务，也不让人等太久
 */
export const FRESHNESS_MS = 50_000;
export const CLAIM_MS = 45_000;
export const BACKOFF_MS = 15_000;
/** 跟随者每 3 秒看一次提交版本号（零查询） */
export const FOLLOW_POLL_MS = 3_000;

/** claimed = 我去取；fresh = 别人刚取过；busy = 别人正在取；unavailable = 库不可写 */
export type ClaimResult = 'claimed' | 'fresh' | 'busy' | 'unavailable';

function nullableBool(value: boolean | null): number | null {
    return value === null ? null : value ? 1 : 0;
}

function fromNullableBool(value: unknown): boolean | null {
    if (value === null || value === undefined) {
        return null;
    }
    return Number(value) === 1;
}

function parseIds(value: unknown): number[] {
    if (typeof value !== 'string' || !value) {
        return [];
    }
    try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? parsed.map((id) => Number(id)).filter((id) => Number.isFinite(id)) : [];
    } catch {
        return [];
    }
}

export class FactStore {
    private constructor(
        private readonly db: SqliteDatabase,
        private readonly readOnly = false
    ) {}

    /** 便捷入口：只要 store。需要诊断信息用 `openWithStatus` */
    public static open(dbPath: string, module: SqliteModule | null = loadSqlite()): FactStore | null {
        return FactStore.openWithStatus(dbPath, module).store;
    }

    /**
     * 打开（或建库）。三条异常路径必须都不崩：
     * - 打开失败 / 完整性不通过 → 改名为 `*.corrupt-<时间>`，重建空库，报「历史已重置」
     * - 库版本高于代码 → 只读模式，报「库来自更新版本」，绝不降级迁移
     * - 迁移 → 每个版本一个事务，迁移前备份 `.bak`，失败就回滚保留原库
     */
    public static openWithStatus(dbPath: string, module: SqliteModule | null = loadSqlite()): OpenResult {
        if (!module) {
            return { store: null, status: 'unavailable', message: UNAVAILABLE_MESSAGE };
        }
        let db: SqliteDatabase | undefined;
        try {
            db = new module.DatabaseSync(dbPath);
            db.exec('PRAGMA busy_timeout=300');
            const integrity = db.prepare('PRAGMA integrity_check').get();
            if (String(integrity?.integrity_check ?? '') !== 'ok') {
                throw new Error('integrity_check 未通过');
            }
        } catch (error) {
            // Windows 上不能改名一个还开着的文件：先把句柄关掉
            try {
                db?.close();
            } catch (closeError) {
                console.warn('[fact-store] 关闭损坏的库失败', closeError);
            }
            console.warn('[fact-store] 事实库打不开或已损坏，改名重建', error);
            return FactStore.rebuild(dbPath, module, error);
        }
        if (!db) {
            return FactStore.rebuild(dbPath, module, new Error('没有拿到数据库句柄'));
        }

        try {
            // WAL 让另一个窗口的读不被写锁挡住；busy_timeout 要小，等待是阻塞式的
            db.exec('PRAGMA journal_mode=WAL');
            db.exec('PRAGMA synchronous=NORMAL');

            const version = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0);

            if (version > SCHEMA_VERSION) {
                db.close();
                const readOnlyDb = new module.DatabaseSync(dbPath, { readOnly: true });
                return {
                    store: new FactStore(readOnlyDb, true),
                    status: 'readonly',
                    message: `事实库来自更新版本（v${version} > v${SCHEMA_VERSION}），本次只读：不会降级迁移，刷新仍然可以看`, 
                };
            }

            if (version < SCHEMA_VERSION) {
                FactStore.backup(db, dbPath);
                for (let step = version; step < SCHEMA_VERSION; step += 1) {
                    db.exec('BEGIN IMMEDIATE');
                    try {
                        MIGRATIONS[step](db);
                        db.exec(`PRAGMA user_version = ${step + 1}`);
                        db.exec('COMMIT');
                    } catch (error) {
                        try {
                            db.exec('ROLLBACK');
                        } catch (rollbackError) {
                            console.warn('[fact-store] 迁移回滚失败', rollbackError);
                        }
                        throw error;
                    }
                }
            }

            const store = new FactStore(db, false);
            if (store.meta('first_seen_at') === null) {
                store.setMeta('first_seen_at', String(Date.now()));
            }
            return { store, status: 'ok', message: null };
        } catch (error) {
            console.warn('[fact-store] 初始化事实库失败，退回单窗口内存态', error);
            try {
                db.close();
            } catch (closeError) {
                console.warn('[fact-store] 关闭数据库失败', closeError);
            }
            return { store: null, status: 'unavailable', message: UNAVAILABLE_MESSAGE };
        }
    }

    /** 迁移前备份。空文件没什么可备的，不刷出一堆 .bak */
    private static backup(db: SqliteDatabase, dbPath: string): void {
        try {
            if (!fs.existsSync(dbPath) || fs.statSync(dbPath).size === 0) {
                return;
            }
            db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
            fs.copyFileSync(dbPath, `${dbPath}.bak`);
        } catch (error) {
            // 备份失败不阻挠迁移：真正的风险是不备份却声称备份了，这里会留下日志
            console.warn('[fact-store] 迁移备份失败', error);
        }
    }

    /** 损坏的库改名让位，重建一个空库；旧文件必须留着，不能删 */
    private static rebuild(dbPath: string, module: SqliteModule, cause: unknown): OpenResult {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const corruptPath = `${dbPath}.corrupt-${stamp}`;
        try {
            fs.renameSync(dbPath, corruptPath);
            for (const suffix of ['-wal', '-shm']) {
                if (fs.existsSync(`${dbPath}${suffix}`)) {
                    fs.renameSync(`${dbPath}${suffix}`, `${corruptPath}${suffix}`);
                }
            }
        } catch (error) {
            console.warn('[fact-store] 无法给损坏的库改名', error);
            return { store: null, status: 'unavailable', message: UNAVAILABLE_MESSAGE };
        }

        try {
            const db = new module.DatabaseSync(dbPath);
            db.exec('PRAGMA journal_mode=WAL');
            db.exec('PRAGMA synchronous=NORMAL');
            db.exec('PRAGMA busy_timeout=300');
            db.exec(DDL_V1);
            db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
            const store = new FactStore(db, false);
            store.setMeta('first_seen_at', String(Date.now()));
            console.warn('[fact-store] 事实库已重建，原文件保留为', corruptPath, cause);
            return {
                store,
                status: 'recovered',
                message: '事实库损坏，已重建；历史已重置，指标从今天起算',
            };
        } catch (error) {
            console.warn('[fact-store] 重建事实库失败', error);
            return { store: null, status: 'unavailable', message: UNAVAILABLE_MESSAGE };
        }
    }

    public close(): void {
        try {
            this.db.close();
        } catch (error) {
            console.warn('[fact-store] 关闭事实库失败', error);
        }
    }

    public schemaVersion(): number {
        return Number(this.db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
    }

    public meta(key: string): string | null {
        try {
            const row = this.db.prepare('SELECT v FROM meta WHERE k = ?').get(key);
            return row?.v === undefined || row.v === null ? null : String(row.v);
        } catch {
            return null;
        }
    }

    public setMeta(key: string, value: string): void {
        if (this.readOnly) {
            return;
        }
        try {
            this.db
                .prepare('INSERT INTO meta(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
                .run(key, value);
        } catch (error) {
            console.warn('[fact-store] 写 meta 失败', error);
        }
    }

    /** 该 scope 上一次成功取数的时间；从未成功为 null */
    public lastSuccessAt(scope: string): number | null {
        try {
            const row = this.db.prepare('SELECT last_success_at FROM fetch_state WHERE scope = ?').get(scope);
            const value = row?.last_success_at;
            return value === undefined || value === null ? null : Number(value);
        } catch {
            return null;
        }
    }

    /**
     * Jira scope 全量替换：board / sprint / issue 与 `last_success_at` 在同一事务里提交。
     * 成功后库中该 scope 的 issue 恰好等于这次快照，没有残留脏行。
     */
    public replaceJira(scope: string, snapshot: JiraSnapshot): boolean {
        return this.transaction(() => {
            const now = Date.now();
            this.db
                .prepare(
                    `INSERT INTO board(board_id, columns_json, rank_field, fetched_at) VALUES (?, ?, ?, ?)
                     ON CONFLICT(board_id) DO UPDATE SET
                       columns_json = excluded.columns_json,
                       rank_field = excluded.rank_field,
                       fetched_at = excluded.fetched_at`
                )
                .run(snapshot.boardId, JSON.stringify(snapshot.columns), snapshot.rankField, now);

            if (snapshot.sprint) {
                this.db
                    .prepare(
                        `INSERT INTO sprint(id, board_id, name, state, start_at, end_at) VALUES (?, ?, ?, ?, ?, ?)
                         ON CONFLICT(id) DO UPDATE SET
                           board_id = excluded.board_id,
                           name = excluded.name,
                           state = excluded.state,
                           start_at = excluded.start_at,
                           end_at = excluded.end_at`
                    )
                    .run(
                        snapshot.sprint.id,
                        snapshot.boardId,
                        snapshot.sprint.name,
                        snapshot.sprint.state,
                        snapshot.sprint.startAt,
                        snapshot.sprint.endAt
                    );
            }

            this.db.prepare('DELETE FROM issue WHERE fetched_scope = ?').run(scope);
            const insert = this.db.prepare(
                `INSERT INTO issue(key, project, sprint_id, status_id, status_name, type, summary, priority,
                                   assignee, epic_key, parent_key, comment_count, rank, updated_at,
                                   fetched_scope, seen_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );
            for (const card of snapshot.cards) {
                insert.run(
                    card.key,
                    card.project,
                    snapshot.sprint?.id ?? null,
                    card.statusId,
                    card.statusName,
                    card.issueType,
                    card.summary,
                    card.priority,
                    card.assignee,
                    card.epicKey,
                    card.parentKey ?? null,
                    card.commentCount,
                    card.rank,
                    card.updatedAtEpoch,
                    scope,
                    now
                );
            }

            this.stampSuccess(scope, now);
        });
    }

    /** GitLab scope 全量替换：mr 与该 scope 下的审批集合一起换掉 */
    public replaceGitLab(scope: string, snapshot: GitLabSnapshot): boolean {
        return this.transaction(() => {
            const now = Date.now();
            this.db.prepare('DELETE FROM mr WHERE fetched_scope = ?').run(scope);

            const insertMr = this.db.prepare(
                `INSERT INTO mr(project, iid, state, title, source_branch, target_branch, author_id, author_name,
                                created_at, updated_at, merged_at, merge_commit_sha, draft, has_conflicts,
                                blocking_discussions_resolved, reviewer_ids, web_url, approved, approvals_left,
                                fetched_scope, seen_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );
            for (const mr of snapshot.mrs) {
                insertMr.run(
                    mr.project,
                    mr.iid,
                    mr.state,
                    mr.title,
                    mr.sourceBranch,
                    mr.targetBranch,
                    mr.authorId,
                    mr.authorName,
                    mr.createdAt,
                    mr.updatedAt,
                    mr.mergedAt,
                    mr.mergeCommitSha,
                    mr.draft ? 1 : 0,
                    nullableBool(mr.hasConflicts),
                    nullableBool(mr.blockingDiscussionsResolved),
                    JSON.stringify(mr.reviewerIds),
                    mr.webUrl,
                    mr.approved === null ? null : mr.approved ? 1 : 0,
                    mr.approvalsLeft,
                    scope,
                    now
                );
            }

            // 审批是快照：只替换本轮真正查过的那几个 MR，绝不能拿整条分支的 iid 去删——
            // 那些行可能属于 MR 板的个人切片，删掉会让「我已批过」退回「待我审」。
            for (const iid of snapshot.queriedApprovalIids) {
                this.db.prepare('DELETE FROM mr_approval WHERE project = ? AND iid = ?').run(snapshot.project, iid);
            }
            const insertApproval = this.db.prepare(
                `INSERT INTO mr_approval(project, iid, user_id, user_name, approved_at, seen_at)
                 VALUES (?, ?, ?, ?, ?, ?)`
            );
            for (const approval of snapshot.approvals) {
                insertApproval.run(
                    approval.project,
                    approval.iid,
                    approval.userId,
                    approval.userName,
                    approval.approvedAt,
                    now
                );
            }

            // 关联结果也按 scope 整体替换：恢复时直接用，不再拿空 description 重新猜
            this.db.prepare('DELETE FROM mr_link WHERE fetched_scope = ?').run(scope);
            const insertLink = this.db.prepare(
                `INSERT INTO mr_link(project, iid, issue_key, matched_by, fetched_scope, seen_at)
                 VALUES (?, ?, ?, ?, ?, ?)`
            );
            for (const link of snapshot.links) {
                insertLink.run(snapshot.project, link.iid, link.issueKey, link.matchedBy, scope, now);
            }

            this.stampSuccess(scope, now);
        });
    }

    /** 构建历史按 job 累积；超过 200 条时删最旧的 */
    public upsertBuilds(jobPath: string, builds: BuildFact[]): boolean {
        return this.transaction(() => {
            const now = Date.now();
            const upsert = this.db.prepare(
                `INSERT INTO build(job_path, number, result, started_at, duration_ms, sha, url, seen_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(job_path, number) DO UPDATE SET
                   result = excluded.result,
                   started_at = excluded.started_at,
                   duration_ms = excluded.duration_ms,
                   sha = excluded.sha,
                   url = excluded.url,
                   seen_at = excluded.seen_at`
            );
            for (const build of builds) {
                upsert.run(jobPath, build.number, build.result, build.timestamp, null, build.sha ?? null, build.url, now);
            }

            const overflow = this.db
                .prepare(
                    `SELECT number FROM build WHERE job_path = ? ORDER BY number DESC LIMIT -1 OFFSET ${BUILD_RETENTION}`
                )
                .all(jobPath);
            const remove = this.db.prepare('DELETE FROM build WHERE job_path = ? AND number = ?');
            for (const row of overflow) {
                remove.run(jobPath, Number(row.number));
            }

            // 构建事实也属于「这个 scope 成功取过一次」：恢复时据此判断 buildsOk
            this.stampSuccess(`jenkins:${jobPath}`, now);
        });
    }

    public issuesOf(scope: string): IssueRow[] {
        return this.read(() =>
            this.db
                .prepare(
                    `SELECT key, project, sprint_id, status_id, status_name, type, summary, priority, assignee,
                            epic_key, parent_key, comment_count, rank, updated_at
                       FROM issue WHERE fetched_scope = ? ORDER BY key`
                )
                .all(scope)
                .map((row) => ({
                    key: String(row.key),
                    project: String(row.project),
                    sprintId: row.sprint_id === null ? null : Number(row.sprint_id),
                    statusId: String(row.status_id),
                    statusName: String(row.status_name),
                    type: String(row.type),
                    summary: String(row.summary),
                    priority: row.priority === null ? null : String(row.priority),
                    assignee: row.assignee === null ? null : String(row.assignee),
                    epicKey: row.epic_key === null ? null : String(row.epic_key),
                    parentKey: row.parent_key === null ? null : String(row.parent_key),
                    commentCount: Number(row.comment_count),
                    rank: row.rank === null ? null : String(row.rank),
                    updatedAt: row.updated_at === null ? null : Number(row.updated_at),
                }))
        );
    }

    public buildsOf(jobPath: string): BuildRow[] {
        return this.read(() =>
            this.db
                .prepare(
                    `SELECT job_path, number, result, started_at, duration_ms, sha, url
                       FROM build WHERE job_path = ? ORDER BY number ASC`
                )
                .all(jobPath)
                .map((row) => ({
                    jobPath: String(row.job_path),
                    number: Number(row.number),
                    result: row.result === null ? null : String(row.result),
                    startedAt: Number(row.started_at),
                    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
                    sha: row.sha === null ? null : String(row.sha),
                    url: row.url === null ? null : String(row.url),
                }))
        );
    }

    public mrsOf(scope: string): MrRow[] {
        return this.read(() =>
            this.db
                .prepare(
                    `SELECT project, iid, state, title, source_branch, target_branch, author_id, author_name,
                            created_at, updated_at, merged_at, merge_commit_sha, draft, has_conflicts,
                            blocking_discussions_resolved, reviewer_ids, web_url, approved, approvals_left
                       FROM mr WHERE fetched_scope = ? ORDER BY iid`
                )
                .all(scope)
                .map((row) => ({
                    project: String(row.project),
                    iid: Number(row.iid),
                    state: String(row.state),
                    title: String(row.title),
                    sourceBranch: String(row.source_branch),
                    targetBranch: String(row.target_branch),
                    authorId: row.author_id === null ? null : Number(row.author_id),
                    authorName: row.author_name === null ? null : String(row.author_name),
                    createdAt: row.created_at === null ? null : Number(row.created_at),
                    updatedAt: row.updated_at === null ? null : Number(row.updated_at),
                    mergedAt: row.merged_at === null ? null : Number(row.merged_at),
                    mergeCommitSha: row.merge_commit_sha === null ? null : String(row.merge_commit_sha),
                    draft: Number(row.draft) === 1,
                    hasConflicts: fromNullableBool(row.has_conflicts),
                    blockingDiscussionsResolved: fromNullableBool(row.blocking_discussions_resolved),
                    reviewerIds: parseIds(row.reviewer_ids),
                    webUrl: row.web_url === null ? null : String(row.web_url),
                    approved: fromNullableBool(row.approved),
                    approvalsLeft: row.approvals_left === null ? null : Number(row.approvals_left),
                }))
        );
    }

    /**
     * 抢一轮取数。
     *
     * SQLite 没有行锁，所以「判断 + 抢占」必须是一条原子 UPDATE，靠 changes() 定胜负：
     * 这是唯一不会两边同时抢到的写法。
     * - 常规：过期且空闲才抢
     * - 手动刷新：忽略新鲜度，但仍不踩别人正在取的那一脚
     */
    public claimScope(scope: string, manual: boolean, owner: string, now = Date.now()): ClaimResult {
        if (this.readOnly) {
            return 'unavailable';
        }
        try {
            this.db
                .prepare('INSERT INTO fetch_state(scope, attempting_until) VALUES (?, 0) ON CONFLICT(scope) DO NOTHING')
                .run(scope);

            const freshnessClause = manual ? '' : 'AND (last_success_at IS NULL OR last_success_at < ?)';
            const sql =
                `UPDATE fetch_state
                    SET attempting_until = ?, last_attempt_at = ?, owner = ?
                  WHERE scope = ? AND attempting_until < ? ${freshnessClause}`;
            const params: unknown[] = [now + CLAIM_MS, now, owner, scope, now];
            if (!manual) {
                params.push(now - FRESHNESS_MS);
            }

            if (Number(this.db.prepare(sql).run(...params).changes) === 1) {
                return 'claimed';
            }

            const row = this.db.prepare('SELECT attempting_until FROM fetch_state WHERE scope = ?').get(scope);
            if (!row) {
                return 'unavailable';
            }
            return Number(row.attempting_until) >= now ? 'busy' : 'fresh';
        } catch (error) {
            console.warn('[fact-store] 抢占取数失败，退回单窗口直连', error);
            return 'unavailable';
        }
    }

    /** 取数失败：退避 15s，last_success_at 不动（失败不得把旧数据标成新鲜） */
    public releaseScope(scope: string, error: string | null, now = Date.now()): void {
        if (this.readOnly) {
            return;
        }
        try {
            this.db
                .prepare('UPDATE fetch_state SET attempting_until = ?, last_error = ? WHERE scope = ?')
                .run(error ? now + BACKOFF_MS : 0, error, scope);
        } catch (caught) {
            console.warn('[fact-store] 释放取数占位失败', caught);
        }
    }

    /**
     * 正常关窗时交还占位，省掉一次 45 秒空窗。
     * 只清自己持有的那一份（owner 校验）：后开先关的窗口不能把别人正在跑的取数放掉。
     */
    public releaseClaim(scope: string, owner: string): void {
        if (this.readOnly) {
            return;
        }
        try {
            this.db
                .prepare(
                    `UPDATE fetch_state SET attempting_until = 0, owner = NULL
                      WHERE scope = ? AND owner = ? AND attempting_until > 0`
                )
                .run(scope, owner);
        } catch (caught) {
            console.warn('[fact-store] 交还取数占位失败', caught);
        }
    }

    /** `PRAGMA data_version`：另一个连接提交后才会变，零查询 */
    public dataVersion(): number | null {
        try {
            const value = Number(this.db.prepare('PRAGMA data_version').get()?.data_version ?? Number.NaN);
            return Number.isFinite(value) ? value : null;
        } catch {
            return null;
        }
    }

    public boardOf(boardId: number): BoardRow | null {
        try {
            const row = this.db
                .prepare('SELECT board_id, columns_json, rank_field, fetched_at FROM board WHERE board_id = ?')
                .get(boardId);
            if (!row) {
                return null;
            }
            return {
                boardId: Number(row.board_id),
                columns: JSON.parse(String(row.columns_json)) as BoardColumn[],
                rankField: String(row.rank_field),
                fetchedAt: Number(row.fetched_at),
            };
        } catch (error) {
            console.warn('[fact-store] 读 board 失败', error);
            return null;
        }
    }

    /** 当前活跃 sprint；恢复渲染时用来填顶栏标题 */
    public activeSprintOf(boardId: number): SprintRow | null {
        try {
            const row = this.db
                .prepare(
                    `SELECT id, name, state FROM sprint
                      WHERE board_id = ? AND state = 'active' ORDER BY id DESC LIMIT 1`
                )
                .get(boardId);
            return row ? { id: Number(row.id), name: String(row.name), state: String(row.state) } : null;
        } catch (error) {
            console.warn('[fact-store] 读 sprint 失败', error);
            return null;
        }
    }

    public fetchStateOf(scope: string): FetchStateRow | null {
        try {
            const row = this.db
                .prepare(
                    `SELECT scope, last_success_at, last_attempt_at, attempting_until, owner, last_error
                       FROM fetch_state WHERE scope = ?`
                )
                .get(scope);
            if (!row) {
                return null;
            }
            return {
                scope: String(row.scope),
                lastSuccessAt: row.last_success_at === null ? null : Number(row.last_success_at),
                lastAttemptAt: row.last_attempt_at === null ? null : Number(row.last_attempt_at),
                attemptingUntil: Number(row.attempting_until),
                owner: row.owner === null ? null : String(row.owner),
                lastError: row.last_error === null ? null : String(row.last_error),
            };
        } catch (error) {
            console.warn('[fact-store] 读 fetch_state 失败', error);
            return null;
        }
    }

    public approvalsOf(project: string, iid: number): ApprovalRow[] {
        return this.read(() =>
            this.db
                .prepare(
                    `SELECT project, iid, user_id, user_name, approved_at
                       FROM mr_approval WHERE project = ? AND iid = ? ORDER BY user_id`
                )
                .all(project, iid)
                .map((row) => ({
                    project: String(row.project),
                    iid: Number(row.iid),
                    userId: Number(row.user_id),
                    userName: row.user_name === null ? null : String(row.user_name),
                    approvedAt: row.approved_at === null ? null : Number(row.approved_at),
                }))
        );
    }

    public linksOf(scope: string): LinkRow[] {
        return this.read(() =>
            this.db
                .prepare(
                    `SELECT iid, issue_key, matched_by FROM mr_link WHERE fetched_scope = ? ORDER BY issue_key, iid`
                )
                .all(scope)
                .map((row) => ({
                    iid: Number(row.iid),
                    issueKey: String(row.issue_key),
                    matchedBy: String(row.matched_by),
                }))
        );
    }

    public columnsOf(table: string): ColumnRow[] {
        return this.read(() =>
            (this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<Record<string, unknown>>).map((row) => ({
                name: String(row.name),
                type: String(row.type),
            }))
        );
    }

    // ---------- internals ----------

    /** 事实 + last_success_at 同一事务：失败一律回滚，返回值只表达成败 */
    private transaction(work: () => void): boolean {
        if (this.readOnly) {
            // 库来自更新版本：只读是单向的，绝不硬写
            return false;
        }
        try {
            this.db.exec('BEGIN IMMEDIATE');
            try {
                work();
                this.db.exec('COMMIT');
                return true;
            } catch (error) {
                try {
                    this.db.exec('ROLLBACK');
                } catch (rollbackError) {
                    console.warn('[fact-store] 回滚失败', rollbackError);
                }
                throw error;
            }
        } catch (error) {
            console.warn('[fact-store] 写库失败，界面沿用内存态', error);
            return false;
        }
    }

    private stampSuccess(scope: string, now: number): void {
        this.db
            .prepare(
                `INSERT INTO fetch_state(scope, last_success_at, last_attempt_at, attempting_until)
                 VALUES (?, ?, ?, 0)
                 ON CONFLICT(scope) DO UPDATE SET
                   last_success_at = excluded.last_success_at,
                   last_attempt_at = excluded.last_attempt_at,
                   attempting_until = 0,
                   owner = NULL,
                   last_error = NULL`
            )
            .run(scope, now, now);
    }

    private read<T>(work: () => T): T | never[] {
        try {
            return work();
        } catch (error) {
            console.warn('[fact-store] 读库失败，界面沿用内存态', error);
            return [];
        }
    }
}
