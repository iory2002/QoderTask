/**
 * 诊断 3：看事实库的刷新健康度，并给 merge_base 计时。
 * 只读，不改库；不打印凭据。
 */
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { GitLabService } = require('../../../out/services/GitLabService.js');

const dbPath = path.join(
    process.env.APPDATA,
    'QoderCN',
    'User',
    'globalStorage',
    'your-name.todo-panel',
    'facts.sqlite'
);
const db = new DatabaseSync(dbPath, { readOnly: true });
const at = (value) => (value === null ? 'null' : new Date(Number(value)).toLocaleString());

console.log('== fetch_state ==');
for (const row of db.prepare('SELECT * FROM fetch_state').all()) {
    console.log(
        `${row.scope}\n  success=${at(row.last_success_at)} attempt=${at(row.last_attempt_at)} ` +
            `until=${at(row.attempting_until)} err=${row.last_error}`
    );
}

const merged = db
    .prepare(
        "SELECT COUNT(*) c FROM mr WHERE state='merged' AND merge_commit_sha IS NOT NULL AND fetched_scope LIKE 'gitlab:%'"
    )
    .get();
const builds = db.prepare('SELECT COUNT(*) c FROM build WHERE sha IS NOT NULL').get();
console.log('\nmerged MR rows with sha =', merged.c, '| builds with sha =', builds.c);
console.log('max issue seen_at =', at(db.prepare('SELECT MAX(seen_at) m FROM issue').get().m));
console.log('max mr seen_at    =', at(db.prepare('SELECT MAX(seen_at) m FROM mr').get().m));

const sample = db
    .prepare(
        "SELECT project, merge_commit_sha FROM mr WHERE state='merged' AND merge_commit_sha IS NOT NULL LIMIT 3"
    )
    .all();
const build = db.prepare('SELECT number, sha FROM build WHERE sha IS NOT NULL ORDER BY number DESC LIMIT 1').get();
db.close();

if (!build || sample.length === 0) {
    console.log('\n没有可用于计时的样本');
    process.exit(0);
}

console.log(`\n== merge_base 计时（构建 #${build.number}）==`);
const gitlab = new GitLabService();
(async () => {
    for (const row of sample) {
        const started = Date.now();
        try {
            const base = await gitlab.getMergeBase(row.project, row.merge_commit_sha, build.sha);
            const contained = String(base).toLowerCase() === String(row.merge_commit_sha).toLowerCase();
            console.log(`${Date.now() - started} ms  包含=${contained}  (${row.merge_commit_sha.slice(0, 8)})`);
        } catch (error) {
            console.log(`${Date.now() - started} ms  失败 status=${error.status ?? '-'} ${String(error.message).slice(0, 100)}`);
        }
    }
    console.log('\n按 4 并发估算：' + Math.round(sample.length) + ' 对样本已计时，实际每轮最多 N_merged×2 对');
})();
