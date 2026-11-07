import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

import { decryptValue } from '../src/services/ScrumBuddyConfig';

test('pure module loads and runs outside the IDE', () => {
    // 明文原样返回：不依赖 ~/.scrumbuddy/config.json，也不依赖 vscode 模块
    assert.equal(decryptValue('plain-token'), 'plain-token');
    assert.equal(decryptValue(''), '');
});

test('a failing test file makes the runner exit non-zero', () => {
    const dir = path.join(__dirname, 'fixtures');
    fs.mkdirSync(dir, { recursive: true });
    const broken = path.join(dir, 'always-fails.js');
    // 刻意不用 *.test.js 命名：这文件只给子进程跑，避免被本跑的发现规则收进来
    fs.writeFileSync(
        broken,
        "const { test } = require('node:test');\n" +
        "const assert = require('node:assert');\n" +
        "test('this assertion must fail', () => { assert.equal(1, 2); });\n"
    );
    try {
        // 必须摘掉 NODE_TEST_CONTEXT：否则子进程会复用父 runner 的 IPC 通道并恒定退出 0
        const env = { ...process.env };
        delete env.NODE_TEST_CONTEXT;
        const result = spawnSync(process.execPath, ['--test', broken], { encoding: 'utf-8', env });
        assert.notEqual(result.status, 0, 'runner must report failure through the exit code');
    } finally {
        fs.rmSync(broken, { force: true });
    }
});
