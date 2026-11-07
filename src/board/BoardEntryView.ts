import * as vscode from 'vscode';

/**
 * 活动栏图标背后的侧边栏条目。
 *
 * 点活动栏图标 → 容器展开 → 这个条目被解析 → 立刻把看板开成编辑器 tab，
 * 于是「点图标 → 出现 tab」成立；条目本身只留一行说明与重开链接。
 */
export class BoardEntryView implements vscode.WebviewViewProvider {
    public static readonly viewType = 'jiraBoard.entry';

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly openBoard: () => void
    ) {}

    public resolveWebviewView(view: vscode.WebviewView): void {
        view.webview.options = {
            enableScripts: false,
            enableCommandUris: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
        };
        view.webview.html = this.renderHtml();
        this.openBoard();
    }

    private renderHtml(): string {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
  body { font: 13px/1.5 var(--vscode-font-family); color: var(--vscode-foreground); padding: 10px 12px; }
  p { margin: 0 0 8px; }
  .muted { color: var(--vscode-descriptionForeground); }
  a { color: var(--vscode-textLink-foreground); }
</style>
</head>
<body>
<p>Jira 看板在编辑器标签页里打开。</p>
<p class="muted">标签被关掉后，用下面的链接重新打开。</p>
<p><a href="command:todoPanel.openBoard">打开 Jira 看板</a></p>
</body>
</html>`;
    }
}
