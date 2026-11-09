/**
 * 只读探针（会写 %TEMP% 下的临时 db，不碰仓库与用户数据）：
 * 验证 node:sqlite 在多进程下的实际行为，为 01 号票（共享事实库）提供依据。
 *
 * 用宿主自己的运行时跑（与扩展宿主同版本）：
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   & "C:\Program Files\Qoder CN IDE\Qoder CN IDE.exe" .scratch/devops-board/research/probe-sqlite-concurrency.js
 *
 * 子进程用 process.execPath + 同一环境变量，确保跑的是同一个 Node。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

// 放仓库内（沙箱下只有工作区可写）；脚本跑完会自己删掉，不要提交
const DB = path.join(__dirname, 'tmp-probe.sqlite');
const MODE = (process.argv[2] || '').replace('--mode=', '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function open() {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(DB);
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('PRAGMA busy_timeout=2000');
    db.exec('PRAGMA synchronous=NORMAL');
    return db;
}

function runChild(mode) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [__filename, `--mode=${mode}`], {
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '';
        let err = '';
        child.stdout.on('data', (c) => (out += c));
        child.stderr.on('data', (c) => (err += c));
        child.on('exit', (code) => resolve({ mode, code, out: out.trim(), err: err.trim() }));
    });
}

(async () => {
    if (MODE === 'leader') {
        const db = open();
        db.exec('CREATE TABLE IF NOT EXISTS fact (k TEXT PRIMARY KEY, v TEXT)');
        const t0 = Date.now();
        db.exec('BEGIN IMMEDIATE');
        db.prepare('INSERT OR REPLACE INTO fact (k, v) VALUES (?, ?)').run('leader', new Date().toISOString());
        console.log(`leader: write lock held at +${Date.now() - t0}ms, sleeping 3000ms`);
        await sleep(3000);
        db.exec('COMMIT');
        console.log(`leader: committed at +${Date.now() - t0}ms`);
        db.close();
        return;
    }

    if (MODE === 'follower') {
        const db = open();
        const t0 = Date.now();
        // 1) 读：WAL 下应该不被写锁挡住
        try {
            const row = db.prepare('SELECT v FROM fact WHERE k = ?').get('leader');
            console.log(`follower: read OK at +${Date.now() - t0}ms value=${row ? 'present' : 'null'}`);
        } catch (e) {
            console.log(`follower: read FAILED at +${Date.now() - t0}ms ${e.code || e.message}`);
        }
        // 2) 写：busy_timeout=2000，leader 还占着锁
        const t1 = Date.now();
        try {
            db.prepare('INSERT OR REPLACE INTO fact (k, v) VALUES (?, ?)').run('follower', new Date().toISOString());
            console.log(`follower: write OK after ${Date.now() - t1}ms`);
        } catch (e) {
            console.log(`follower: write FAILED after ${Date.now() - t1}ms code=${e.code || e.message}`);
        }
        db.close();
        return;
    }

    if (MODE === 'bench') {
        const db = open();
        db.exec('CREATE TABLE IF NOT EXISTS fact (k TEXT PRIMARY KEY, v TEXT)');
        const rows = 500;
        let t = Date.now();
        db.exec('BEGIN IMMEDIATE');
        const stmt = db.prepare('INSERT OR REPLACE INTO fact (k, v) VALUES (?, ?)');
        for (let i = 0; i < rows; i += 1) {
            stmt.run(`bench-${i}`, 'x'.repeat(80));
        }
        db.exec('COMMIT');
        const batch = Date.now() - t;

        t = Date.now();
        for (let i = 0; i < 50; i += 1) {
            stmt.run(`autocommit-${i}`, 'y'.repeat(80));
        }
        const autocommit = Date.now() - t;

        t = Date.now();
        const count = db.prepare('SELECT COUNT(*) AS n FROM fact').get().n;
        const readMs = Date.now() - t;
        console.log(`bench: ${rows} rows in one txn = ${batch}ms；50 rows autocommit = ${autocommit}ms；COUNT(*) = ${count} in ${readMs}ms`);
        db.close();
        return;
    }

    // parent
    for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) {
        try {
            fs.unlinkSync(f);
        } catch {}
    }
    const bench = await runChild('bench');
    console.log(bench.out || bench.err);

    const leader = runChild('leader');
    await sleep(900);
    const follower = await runChild('follower');
    const leaderDone = await leader;

    console.log(leaderDone.out);
    if (leaderDone.err) console.log(`leader stderr: ${leaderDone.err.split('\n')[0]}`);
    console.log(follower.out);
    if (follower.err) console.log(`follower stderr: ${follower.err.split('\n')[0]}`);

    const db = open();
    const n = db.prepare('SELECT COUNT(*) AS n FROM fact').get().n;
    console.log(`parent: final rows=${n}`);
    db.close();

    await sleep(300);
    for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) {
        try {
            fs.unlinkSync(f);
        } catch {}
    }
})();
