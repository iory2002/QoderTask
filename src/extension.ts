import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { BoardEntryTree } from './board/BoardEntryTree';
import { BoardPanel } from './board/BoardPanel';
import { BoardState } from './board/BoardState';
import { MrBoardPanel } from './board/MrBoardPanel';
import { MrBoardState } from './board/MrBoardState';
import { GitLabService } from './services/GitLabService';
import { JiraService } from './services/JiraService';
import { buildReviewRequest } from './services/MrReviewHandoff';

let boardState: BoardState | undefined;
let mrBoardState: MrBoardState | undefined;
/** 没有工作区时的 diff 落盘位置 */
let storageRoot: vscode.Uri | undefined;

export function activate(context: vscode.ExtensionContext) {
    try {
        const factsPath = ensureFactsPath(context.globalStorageUri.fsPath);
        boardState = new BoardState(factsPath);
        mrBoardState = new MrBoardState(factsPath);
        storageRoot = context.storageUri ?? context.globalStorageUri;

        const openBoard = () => {
            BoardPanel.createOrShow(context.extensionUri, {
                onReady: () => {
                    boardState?.setVisible(true);
                    // WebView 可能刚被重建：即使数据没变也要把当前状态推过去
                    boardState?.republish();
                },
                onRefresh: (force) => boardState?.refresh(force),
                // 纯视图切换：不重新拉数据，由 BoardState 直接重发当前快照
                onScopeChange: (scope) => boardState?.setScope(scope),
                onOpenJira: (key) => openJiraIssue(key),
                onOpenExternal: (url) => openExternal(url),
                onVisibilityChanged: (visible) => boardState?.setVisible(visible),
                onDisposed: () => boardState?.setVisible(false),
            });
        };

        const openMrBoard = () => {
            MrBoardPanel.createOrShow(context.extensionUri, {
                onReady: () => {
                    mrBoardState?.setVisible(true);
                    mrBoardState?.republish();
                },
                onRefresh: (force) => mrBoardState?.refresh(force),
                onOpenExternal: (url) => openExternal(url),
                onOpenJira: (key) => openJiraIssue(key),
                onReview: (payload) => startReview(payload),
                onCopyLink: async (url) => {
                    await vscode.env.clipboard.writeText(url);
                    void vscode.window.showInformationMessage(`已复制 MR 链接：${url}`);
                },
                onVisibilityChanged: (visible) => mrBoardState?.setVisible(visible),
                onDisposed: () => mrBoardState?.setVisible(false),
            });
        };

        context.subscriptions.push(
            vscode.commands.registerCommand('todoPanel.openBoard', () => openBoard())
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('todoPanel.openMrBoard', () => openMrBoard())
        );

        // 设置入口：直接打开 Settings UI 并过滤到本扩展，省得用户去扩展列表里翻
        context.subscriptions.push(
            vscode.commands.registerCommand('todoPanel.openSettings', () =>
                vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`)
            )
        );

        // 原来的「同步 Jira」命令重定义为「刷新看板」，不再有语义重叠的入口
        context.subscriptions.push(
            vscode.commands.registerCommand('todoPanel.refresh', async () => {
                if (!BoardPanel.exists()) {
                    openBoard();
                    return;
                }
                await boardState?.refresh(true);
            })
        );

        // 设置入口：只按扩展过滤，让设置页展示「PC Board: Jira」/「PC Board: GitLab」两个分组。
        // 再细到具体键就只剩一条，用户看不到整组。
        const openJiraSettings = () =>
            vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`);

        const openGitlabSettings = () =>
            vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`);

        context.subscriptions.push(
            vscode.commands.registerCommand('pcBoard.openJiraSettings', openJiraSettings),
            vscode.commands.registerCommand('pcBoard.openGitlabSettings', openGitlabSettings)
        );

        // 两个活动栏图标各一个侧边栏条目：点开图标即打开各自的看板，不再互相跳转。
        // 用 TreeView（不是 WebviewView）：视图实例在 activate 时就存在，角标不用等用户点一次。
        const jiraEntry = new BoardEntryTree({
            viewType: 'jiraBoard.entry',
            title: 'Jira Board',
            labels: ['开发中', '测试中'],
            openCommand: 'todoPanel.openBoard',
            counts: () => boardState?.getBadgeCounts() ?? { primary: 0, secondary: 0 },
            settingsCommand: 'pcBoard.openJiraSettings',
            openBoard,
        });

        const gitlabEntry = new BoardEntryTree({
            viewType: 'gitlabBoard.entry',
            title: 'GitLab Board',
            labels: ['待我审', '等别人审'],
            openCommand: 'todoPanel.openMrBoard',
            counts: () => mrBoardState?.getBadgeCounts() ?? { primary: 0, secondary: 0 },
            settingsCommand: 'pcBoard.openGitlabSettings',
            openBoard: openMrBoard,
        });

        for (const [viewType, entry] of [
            ['jiraBoard.entry', jiraEntry],
            ['gitlabBoard.entry', gitlabEntry],
        ] as const) {
            const view = vscode.window.createTreeView(viewType, {
                treeDataProvider: entry,
                showCollapseAll: false,
            });
            entry.attach(view);
            context.subscriptions.push(view, entry);
        }

        // 角标与侧边栏条目同源：BoardState 算出新数字就推过来
        boardState.setBadgeListener((counts) => jiraEntry.update(counts));
        mrBoardState.setBadgeListener((counts) => gitlabEntry.update(counts));

        // 面板没打开也要有角标，所以激活即开表（不可见时降频）
        boardState.start();
        mrBoardState.start();

        context.subscriptions.push({
            dispose: () => {
                boardState?.dispose();
                mrBoardState?.dispose();
            },
        });
        console.log('[pc-board] extension activated');
    } catch (error) {
        console.error('[pc-board] activation failed', error);
        vscode.window.showErrorMessage(`PC Board 启动失败：${error}`);
    }
}

/**
 * 事实库路径。全局存储按用户共享：同一台机器上多个 IDE 窗口指向同一个文件，
 * 这正是「多开共享」的物理基础（协调协议见 .scratch/devops-board/research/02）。
 * 目录不可写就返回 undefined，界面退回内存态。
 */
function ensureFactsPath(dir: string): string | undefined {
    try {
        fs.mkdirSync(dir, { recursive: true });
        return path.join(dir, 'facts.sqlite');
    } catch (error) {
        console.warn('[pc-board] 无法创建全局存储目录，事实库禁用', error);
        return undefined;
    }
}

/**
 * 评审交接：diff 落盘 → 指令进剪贴板 → 提示用户粘贴回车。
 *
 * 不尝试打开聊天会话：workbench.action.newChat 是聊天 WebView 的内部命令，
 * 不是 VS Code 命令（见 docs/adr/0001）。
 */
async function startReview(payload: { iid: number; projectPath: string }): Promise<void> {
    const card = mrBoardState?.findMr(payload.iid, payload.projectPath);
    if (!card) {
        void vscode.window.showWarningMessage(`找不到 MR !${payload.iid} 的卡片，请先刷新看板`);
        return;
    }

    const gitlab = new GitLabService();
    let diffPath: string | undefined;
    let failure: string | undefined;
    let files: Array<{ path: string; additions: number; deletions: number }> | undefined;
    let filesTruncated = false;

    try {
        const bundle = await gitlab.getMrDiffs(card.projectPath, card.iid);
        diffPath = await writeDiffArtifact(card.iid, bundle.text);
        files = bundle.files;
        filesTruncated = bundle.truncated;
    } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        console.warn('[pc-board] 拉取 MR diff 失败，降级为只复制链接', error);
    }

    const text = buildReviewRequest({
        iid: card.iid,
        title: card.title,
        url: card.url,
        diffPath,
        files,
        filesTruncated,
        jiraKeys: card.jiraKeys,
        approvalsKnown: card.approvalsKnown,
        approvedBy: card.approvedBy.map((person) => person.name || person.username).filter(Boolean),
        approvalsLeft: card.approvalsLeft,
    });
    await vscode.env.clipboard.writeText(text);

    if (failure) {
        void vscode.window.showWarningMessage(
            `MR !${card.iid} 的 diff 拉取失败（${failure}），已复制只带链接的审查指令。`
        );
        return;
    }
    void vscode.window.showInformationMessage(
        `审查指令已复制。打开 Qoder 聊天新会话（Ctrl+N）→ 粘贴 → 回车。diff：${diffPath}`
    );
}

async function writeDiffArtifact(iid: number, diff: string): Promise<string> {
    const base = vscode.workspace.workspaceFolders?.[0]?.uri ?? storageRoot;
    if (!base) {
        throw new Error('没有可写的工作区或存储目录');
    }
    const dir = vscode.Uri.joinPath(base, '.scratch', 'mr-board', 'diffs');
    await vscode.workspace.fs.createDirectory(dir);
    const file = vscode.Uri.joinPath(dir, `!${iid}.diff`);
    await vscode.workspace.fs.writeFile(file, Buffer.from(diff, 'utf-8'));
    return file.fsPath;
}

async function openJiraIssue(key: string): Promise<void> {
    const jira = new JiraService();
    await openExternal(jira.browseUrl(key));
}

async function openExternal(url: string): Promise<void> {
    if (!/^https?:\/\//i.test(url)) {
        vscode.window.showWarningMessage(`拒绝打开非 http(s) 链接：${url}`);
        return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(url));
}

export function deactivate() {
    boardState?.dispose();
    boardState = undefined;
    mrBoardState?.dispose();
    mrBoardState = undefined;
}
