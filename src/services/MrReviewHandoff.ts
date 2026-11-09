/**
 * 评审交接的指令文本。
 *
 * Qoder 的聊天面板没有对外的「新建会话并预填」命令（见 ADR 0001），
 * 扩展能做的最后一公里就是把一条可直接发送的指令放进剪贴板。
 * 指令里必须写死「只审这个 MR、不要审当前工作区」——否则 /code-review
 * 会去审当前仓库的 git diff，而那和这个 MR 毫无关系。
 *
 * 2026-11 起，指令里还带一份**只写可证明事实**的要点单：文件数/增删行、
 * 目录分布、敏感变更、关联 Jira 卡、批准现状。这些全部来自已经拉下来的
 * 那次 diff 与列表响应，不新增任何请求；缺失的类别整行省略，不写「无」。
 */

import type { DiffFileFact } from './DiffFacts';

export interface ReviewBriefInput {
    iid: number;
    title: string;
    url: string;
    /** 本地 diff 文件路径；undefined = diff 没落盘 */
    diffPath?: string;
    /** undefined = diff 取数失败；空数组 = diff 里没有文件（事实缺失，不写「0 个文件」） */
    files?: DiffFileFact[];
    /** true = diff 文件数超过取数上限，数字只能写「至少」 */
    filesTruncated?: boolean;
    jiraKeys?: string[];
    /** false = /approvals 取数失败，批准现状不许写 */
    approvalsKnown?: boolean;
    approvedBy?: string[];
    approvalsLeft?: number | null;
}

/**
 * 敏感变更的固定规则集合。改到这些地方，评审的重点和普通业务代码不同，
 * 但工具只负责指出「碰到了」，不替评审者下结论。
 */
const SENSITIVE_RULES: Array<{ label: string; matches: (path: string) => boolean }> = [
    {
        label: '构建工程文件',
        matches: (path) => /\.(vcxproj|props|sln)$/i.test(path) || /\.vcxproj\.filters$/i.test(path),
    },
    {
        label: '依赖清单',
        matches: (path) =>
            /(^|\/)(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|npm-shrinkwrap\.json)$/i.test(path),
    },
    {
        label: '构建脚本',
        matches: (path) =>
            /^scripts\/build[^/]*$/i.test(path) ||
            /(^|\/)(build-webview|webpack\.config|vite\.config|rollup\.config|esbuild\.config)\.[cm]?[jt]s$/i.test(path) ||
            /(^|\/)Makefile$/i.test(path),
    },
    {
        label: '扩展与前端共享类型',
        matches: (path) => /^src\/models\//i.test(path),
    },
    {
        label: 'SQL 与迁移',
        matches: (path) => /\.sql$/i.test(path) || /(^|\/)migrations\//i.test(path),
    },
];

/** 一行 diff 里真正的增删行数（`+++` / `---` 文件头不算） */
export { countChangedLines } from './DiffFacts';

export function sensitiveLabels(path: string): string[] {
    return SENSITIVE_RULES.filter((rule) => rule.matches(path)).map((rule) => rule.label);
}

function directoryOf(path: string): string {
    const index = path.lastIndexOf('/');
    return index === -1 ? '（根目录）' : path.slice(0, index);
}

function describeDirectories(files: DiffFileFact[]): string | null {
    const counts = new Map<string, number>();
    for (const file of files) {
        const dir = directoryOf(file.path);
        counts.set(dir, (counts.get(dir) ?? 0) + 1);
    }
    if (counts.size === 0) {
        return null;
    }
    const ordered = [...counts.entries()].sort((left, right) => {
        // 根目录排最后：「（根目录）」不是真目录，放前面会抢眼
        const leftRoot = left[0] === '（根目录）';
        const rightRoot = right[0] === '（根目录）';
        if (leftRoot !== rightRoot) {
            return leftRoot ? 1 : -1;
        }
        return right[1] - left[1] || left[0].localeCompare(right[0]);
    });
    const head = ordered.slice(0, 5).map(([dir, count]) => `${dir}（${count}）`).join('、');
    return ordered.length > 5 ? `${head} 等 ${ordered.length} 个目录` : head;
}

function describeSensitive(files: DiffFileFact[]): string | null {
    // 按规则表的固定顺序输出，不随文件在 diff 里的先后变化
    const parts: string[] = [];
    for (const rule of SENSITIVE_RULES) {
        const paths = files.filter((file) => rule.matches(file.path)).map((file) => file.path);
        if (paths.length > 0) {
            parts.push(`${rule.label}（${paths.join('、')}）`);
        }
    }
    return parts.length > 0 ? parts.join('；') : null;
}

function describeApprovals(input: ReviewBriefInput): string | null {
    if (input.approvalsKnown !== true) {
        return null;
    }
    const names = (input.approvedBy ?? []).filter(Boolean);
    if (names.length === 0) {
        return '还没有人批准';
    }
    const left = input.approvalsLeft ?? 0;
    return left > 0 ? `${names.join('、')}（还差 ${left} 个批准）` : names.join('、');
}

/** 事实行：缺失即整行省略 */
function factLines(input: ReviewBriefInput): string[] {
    const lines: string[] = [];
    const files = input.files;

    if (files && files.length > 0) {
        const additions = files.reduce((sum, file) => sum + file.additions, 0);
        const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
        const count = input.filesTruncated ? `至少 ${files.length} 个文件` : `${files.length} 个文件`;
        lines.push(`- 改动 ${count}，+${additions} / -${deletions} 行`);

        const directories = describeDirectories(files);
        if (directories) {
            lines.push(`- 目录：${directories}`);
        }

        const sensitive = describeSensitive(files);
        if (sensitive) {
            lines.push(`- 敏感变更：${sensitive}`);
        }
    }

    const jiraKeys = (input.jiraKeys ?? []).filter(Boolean);
    if (jiraKeys.length > 0) {
        lines.push(`- 关联 Jira：${jiraKeys.join('、')}`);
    }

    const approvals = describeApprovals(input);
    if (approvals) {
        lines.push(`- 批准：${approvals}`);
    }

    return lines;
}

export function buildReviewRequest(input: ReviewBriefInput): string {
    const head = `/code-review 审查 GitLab MR !${input.iid}（${input.title}），链接 ${input.url}。`;
    const lines = factLines(input);
    const facts = lines.length > 0 ? `\n事实：\n${lines.join('\n')}\n` : '';

    if (input.diffPath) {
        return `${head}${facts}diff 已保存到 ${input.diffPath}。只审这个 MR 的改动，不要审当前工作区。`;
    }
    return `${head}${facts}用 scrum-buddy 的 gitlab_get_mr_diff 取 diff，只审这个 MR 的改动，不要审当前工作区。`;
}
