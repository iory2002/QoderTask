# 00: 测试基线

**What to build:** 一个能真正跑起来的测试入口，让后面所有纯逻辑（尤其是交付阶段判定）有回归保护。不测 UI、不连外网，只保证「改坏了会红」。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `npm test` 在干净 checkout 上可跑，不需要网络、不需要启动 IDE
- [ ] 至少一个用例覆盖了「失败会让进程退出码非零」这件事（证明 runner 真在跑，不是空跑通过）
- [ ] 测试文件不进入 `npm run compile` 的产物（`out/` 里不应出现测试文件）
- [ ] `package.json` 的 scripts 里能查到测试命令，README 有半行说明