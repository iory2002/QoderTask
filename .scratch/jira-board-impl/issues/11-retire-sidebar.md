# 11: 退役侧边栏与收口

**What to build:** 看板成为唯一入口。旧的侧边栏待办面板、它的本地数据、以及只为它存在的命令全部下线，README 讲清楚「本地待办不可逆下线、入口挪到哪」。

**Blocked by:** 06

**Status:** resolved

- [x] 活动栏只剩看板入口，旧的侧边栏待办视图无法打开
- [x] 本地待办的数据读写代码与相关命令被移除，不留下半启用的死代码路径
- [x] 原来看板之外的同步命令要么被重定义为「刷新看板」，要么被删除，命令面板里不再出现多个语义重叠的入口
- [x] README 写清楚：本地待办已下线（不可逆）、新入口在哪、如何打开看板
- [x] 旧版本残留的数据文件存在与否都不影响启动，也不报错
- [x] 打一次 vsix 并在干净环境安装，确认首次打开即可看到看板，无需手工改配置之外的步骤

## Comments

- 删除：`src/providers/TodoWebviewProvider.ts`、`src/services/LocalFileTodoService.ts`、`src/services/TodoService.ts`、`src/models/Todo.ts`。`.todo-data.json` 不再有任何读写代码，文件残留也不会被读到。
- `package.json`：活动栏容器只剩 `jira-board`；命令只剩 `todoPanel.openBoard`（Jira Board: Open Board）与 `todoPanel.refresh`（重定义为 **Jira Board: Refresh**）；`addTodo` / `syncGitLab` / `clearAll` 与 `view/title` 菜单全部移除。displayName 改为 `Jira Board`，版本 0.3.0。
- `todoPanel.refresh` 在看板没打开时会先把看板打开再刷新，避免「按了没反应」。
- 新增 `scripts/clean-out.js`：编译前清空 `out/`。tsc 不会删失效产物，否则删掉的侧边栏模块仍会留在 vsix 里（等于死代码继续发布）。已核对 `out/` 只剩新模块。
- `npm run package` 产出 `todo-panel-0.3.0.vsix`（26 个文件 / 65.9 KB），只含 `out/`、`media/`、`package.json`、`README.md`、`LICENSE.txt`、`icon.png`；`*.map`、`src/`、`webview/`、`test/`、`.scratch/` 均被排除。
- README 重写：明确写了「本地待办已下线（不可逆）」、新的活动栏入口、三种打开方式、`todoPanel.*` 设置与 repo 映射、构建与安装命令。
- **未在本机执行安装**：`--install-extension` 会覆盖用户当前已装版本，交由用户自行安装验证；打包本身已通过。
