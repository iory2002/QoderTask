# 00: 测试基线

**What to build:** 一个能真正跑起来的测试入口，让后面所有纯逻辑（尤其是交付阶段判定）有回归保护。不测 UI、不连外网，只保证「改坏了会红」。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `npm test` 在干净 checkout 上可跑，不需要网络、不需要启动 IDE
- [x] 至少一个用例覆盖了「失败会让进程退出码非零」这件事（证明 runner 真在跑，不是空跑通过）
- [x] 测试文件不进入 `npm run compile` 的产物（`out/` 里不应出现测试文件）
- [x] `package.json` 的 scripts 里能查到测试命令，README 有半行说明

## Comments

- `tsconfig.test.json` 把 `src/**` + `test/**` 编到 `.test-out/`（已 gitignore），`tsconfig.json` 的 `include` 收紧到 `src/**`，所以 `out/` 不会出现测试文件。
- `npm test` = `pretest`（tsc -p tsconfig.test.json）+ `node --test ".test-out/test/**/*.test.js"`。目录形式在 Node 24 会被当成入口脚本，必须用 glob。
- 自检用例里 spawn 子 runner 时必须删掉 `NODE_TEST_CONTEXT`，否则子进程复用父 runner 的 IPC 通道、恒定退出 0，自检会变成假绿。
