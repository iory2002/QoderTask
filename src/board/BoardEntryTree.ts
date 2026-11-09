import * as vscode from 'vscode';

import type { BadgeCounts } from '../services/BadgeCounter';

export interface BoardEntryOptions {
    /** 视图 id，必须与 package.json 的 views 一致 */
    viewType: string;
    /** 活动栏容器名 / 视图标题 */
    title: string;
    /** 两个数字的说明，如 ['开发中', '测试中'] */
    labels: [string, string];
    /** 点数字行要执行的命令（打开对应看板） */
    openCommand: string;
    /** 「打开设置」行执行的命令 */
    settingsCommand: string;
    /** 计数来源：由 extension.ts 接到对应的 BoardState */
    counts: () => BadgeCounts;
    openBoard: () => void;
}

/**
 * 活动栏图标背后的侧边栏条目（Jira / GitLab 各一个实例）。
 *
 * 故意用 TreeView 而不是 WebviewView：WebviewView 只有在视图被第一次展开时才会被
 * 创建，在那之前扩展拿不到实例，活动栏角标也就设不上——表现就是「启动后没有角标，
 * 点一下图标才出现」。TreeView 在 activate 时就能创建实例，badge 立刻可设。
 *
 * 展开后就是三行：开发中 / 测试中（点开对应看板）、打开设置。
 */
export class BoardEntryTree implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
    public readonly onDidChangeTreeData = this.changed.event;

    private view: vscode.TreeView<vscode.TreeItem> | undefined;
    private counts: BadgeCounts = { primary: 0, secondary: 0 };

    constructor(private readonly options: BoardEntryOptions) {}

    /** 必须在 activate 里立刻调用：先拿到 TreeView 实例，badge 才有地方挂 */
    public attach(view: vscode.TreeView<vscode.TreeItem>): void {
        this.view = view;
        this.apply(this.counts);
        // 点活动栏图标 → 视图变为可见 → 打开对应看板；启动恢复时不触发，避免自动弹 tab
        view.onDidChangeVisibility((event) => {
            if (event.visible) {
                this.options.openBoard();
            }
        });
        this.changed.fire();
    }

    /** BoardState 每次算出新数字时调用：同时更新活动栏角标与条目内容 */
    public update(counts: BadgeCounts): void {
        this.counts = counts;
        this.apply(counts);
        this.changed.fire();
    }

    public getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    public getChildren(): vscode.TreeItem[] {
        const [primaryLabel, secondaryLabel] = this.options.labels;
        return [
            this.countRow(primaryLabel, this.counts.primary, 'charts.red'),
            this.countRow(secondaryLabel, this.counts.secondary, 'charts.green'),
            this.actionRow('打开设置', 'gear', this.options.settingsCommand),
        ];
    }

    public dispose(): void {
        this.changed.dispose();
    }

    private apply(counts: BadgeCounts): void {
        const view = this.view;
        if (!view) {
            return;
        }
        const [primaryLabel, secondaryLabel] = this.options.labels;
        const summary = `${primaryLabel} ${counts.primary} · ${secondaryLabel} ${counts.secondary}`;

        view.badge = counts.primary > 0
            ? { value: counts.primary, tooltip: `${this.options.title}：${summary}` }
            : undefined;
        view.description = summary;
    }

    private countRow(label: string, value: number, color: string): vscode.TreeItem {
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.description = String(value);
        item.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor(color));
        item.tooltip = `${label} ${value}`;
        item.command = { command: this.options.openCommand, title: label };
        return item;
    }

    private actionRow(label: string, icon: string, command: string): vscode.TreeItem {
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(icon);
        item.command = { command, title: label };
        return item;
    }
}
