# 02: MR 卡信号：冲突上卡面，未解决讨论进详情

**What to build:** 有冲突的 MR 在卡面直接显示红字「有冲突」；点开详情能看到「N 条未解决讨论」。不用去 GitLab 才知道这个 MR 需要我改。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 有冲突的 MR 卡面显示红字，无冲突时不显示
- [ ] 详情显示未解决讨论条数；字段缺失时显示"未知"，不能当成 0
- [ ] 不新增对外请求（两个字段由 MR 列表接口直接返回）
- [ ] 单测：未知 ≠ false ≠ 无问题
