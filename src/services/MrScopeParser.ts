/**
 * GitLab 看板取数范围的解析：每行一条 `仓库路径@目标分支`。
 *
 * 之所以用字符串而不是对象数组：Settings UI 对 `array<object>` 只能跳去
 * settings.json 编辑，而 `array<string>` 会直接给出「添加项 + 输入框」。
 */

export interface MrScopeEntry {
    gitlabProject: string;
    targetBranch: string;
}

export interface ParsedScopes {
    entries: MrScopeEntry[];
    /** 解析失败的原始行：不静默丢弃，交给调用方提示 */
    invalid: string[];
}

/** 仓库路径里理论上可能含 @，所以按最后一个 @ 切分 */
export function parseScopeLine(line: string): MrScopeEntry | null {
    const trimmed = line.trim();
    if (!trimmed) {
        return null;
    }
    const at = trimmed.lastIndexOf('@');
    if (at <= 0 || at === trimmed.length - 1) {
        return null;
    }
    const gitlabProject = trimmed.slice(0, at).trim();
    const targetBranch = trimmed.slice(at + 1).trim();
    if (!gitlabProject || !targetBranch) {
        return null;
    }
    return { gitlabProject, targetBranch };
}

export function parseScopeLines(lines: string[]): ParsedScopes {
    const entries: MrScopeEntry[] = [];
    const invalid: string[] = [];
    const seen = new Set<string>();

    for (const line of lines) {
        if (!line || !line.trim()) {
            continue;
        }
        const entry = parseScopeLine(line);
        if (!entry) {
            invalid.push(line.trim());
            continue;
        }
        const key = `${entry.gitlabProject}@${entry.targetBranch}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        entries.push(entry);
    }

    return { entries, invalid };
}
