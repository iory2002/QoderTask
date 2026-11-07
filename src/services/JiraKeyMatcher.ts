/**
 * 从自由文本里抽 Jira key。
 *
 * 三条硬约束（都是实测踩出来的）：
 * 1. 正则必须带项目白名单，否则 `C1-6`、`L3-12`、`ML6-15` 会被当成 key；
 * 2. 长 key 排前面，`NEX2` 必须优先于 `NEX`；
 * 3. 标题常见的 `NEX2-1038+1039` 要按前缀继承补出 `NEX2-1039`，否则那张卡会被误判成「未提交」。
 */

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keyPattern(projects: string[]): RegExp {
    const ordered = [...new Set(projects.map((project) => project.trim().toUpperCase()).filter(Boolean))].sort(
        (left, right) => right.length - left.length
    );
    if (ordered.length === 0) {
        return /(?!)/g;
    }
    // 一个 key 后面可以跟一串 `+1039` / `, 1039`，这些编号继承前面的项目前缀
    return new RegExp(`\\b(${ordered.map(escapeRegExp).join('|')})-(\\d+)\\b((?:\\s*[+,]\\s*\\d+\\b)*)`, 'g');
}

/** 按出现顺序返回去重后的 key；没有命中就是空数组 */
export function extractJiraKeys(text: string | null | undefined, projects: string[]): string[] {
    if (!text) {
        return [];
    }
    const found: string[] = [];
    const seen = new Set<string>();
    const push = (key: string) => {
        if (!seen.has(key)) {
            seen.add(key);
            found.push(key);
        }
    };

    const pattern = keyPattern(projects);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
        const project = match[1];
        push(`${project}-${match[2]}`);
        const tail = match[3] ?? '';
        for (const extra of tail.match(/\d+/g) ?? []) {
            push(`${project}-${extra}`);
        }
    }
    return found;
}
