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
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Array<Record<string, unknown>>;
}

export interface SqliteDatabase {
    exec(sql: string): void;
    prepare(sql: string): SqliteStatement;
    close(): void;
}

export interface SqliteModule {
    DatabaseSync: new (path: string) => SqliteDatabase;
}

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
}

export interface ColumnRow {
    name: string;
    type: string;
}

/** 每个 job 只留最近 200 条构建：历史账本，不无限长 */
export const BUILD_RETENTION = 200;

function nullableBool(value: boolean | null): number | null {
    return value === null ? null : value ? 1 : 0;
}

function fromNullableBool(value: unknown): boolean | null {
    if (value === null || value === undefined) {
        return null;
    }
    return Number(value) === 1;
}

export class FactStore {
    private constructor(private readonly db: SqliteDatabase) {}

    /**
     * 打开（或建库）。失败返回 null —— 调用方继续用内存态，不抛到界面。
     * 迁移/损坏重建/高版本只读由 09 完整实现；这里只做幂等建库。
     */
    public static open(dbPath: string, module: SqliteModule | null = loadSqlite()): FactStore | null {
        if (!module) {
            return null;
        }
        try {
            const db = new module.DatabaseSync(dbPath);
            // WAL 让另一个窗口的读不被写锁挡住；busy_timeout 要小，等待是阻塞式的
            db.exec('PRAGMA journal_mode=WAL');
            db.exec('PRAGMA synchronous=NORMAL');
            db.exec('PRAGMA busy_timeout=300');
            db.exec(DDL_V1);

            const version = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
            if (version < SCHEMA_VERSION) {
                db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
            }

            const store = new FactStore(db);
            if (store.meta('first_seen_at') === null) {
                store.setMeta('first_seen_at', String(Date.now()));
            }
            return store;
        } catch (error) {
            console.warn('[fact-store] 打开事实库失败，退回单窗口内存态', error);
            return null;
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
        this.db.prepare('INSERT INTO meta(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(
            key,
            value
        );
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
                                blocking_discussions_resolved, fetched_scope, seen_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
                    scope,
                    now
                );
            }

            // 审批是快照：先删掉本 scope 内所有 MR 的审批，再按本次结果写
            const iids = [...new Set(snapshot.mrs.map((mr) => mr.iid))];
            for (const iid of iids) {
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
                            blocking_discussions_resolved
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
