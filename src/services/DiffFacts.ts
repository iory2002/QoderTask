/** 一个改动文件的可证明事实：路径与增删行数（全部从已拉下来的 diff 里数出来） */
export interface DiffFileFact {
    path: string;
    additions: number;
    deletions: number;
}

/** 一行 diff 里真正的增删行数（`+++` / `---` 文件头不算） */
export function countChangedLines(diff: string): { additions: number; deletions: number } {
    let additions = 0;
    let deletions = 0;
    for (const line of diff.split('\n')) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
            additions += 1;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            deletions += 1;
        }
    }
    return { additions, deletions };
}
