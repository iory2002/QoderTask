import type { BoardColumn } from '../models/Board';

/**
 * 列名 / 列 id 归一：忽略大小写、首尾空白与连续空白。
 *
 * 看板列名里带空格（`To Do` / `In Code Review`），用户在设置里手填时
 * 大小写与空格基本不会和 Jira 上完全一致，这里统一抹平后再比较。
 */
function normalize(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * 设置里的「要隐藏的列」→ 真正要隐藏的列 id。
 *
 * 只决定渲染哪些列：卡片仍然全量拉回，角标、列外计数、顶栏总数都不看这个集合，
 * 所以隐藏 To Do / In Progress 不会改变「开发中」的数字。
 * 列名和列 id 都接受：列改名后填 id 仍然能命中。
 */
export function hiddenColumnIdsOf(columns: BoardColumn[], hidden: string[]): string[] {
    const wanted = new Set(hidden.map(normalize).filter(Boolean));
    if (wanted.size === 0) {
        return [];
    }
    return columns
        .filter((column) => wanted.has(normalize(column.name)) || wanted.has(normalize(column.id)))
        .map((column) => column.id);
}

/**
 * 看板菜单里勾选的「要显示的列」→ 要写回设置的隐藏列名。
 *
 * 写列名而不是 id：设置页里看得懂，改了列名也能对上（匹配仍不区分大小写）。
 * 顺序跟随看板列顺序，未知 id 直接忽略；全部勾选时返回空数组。
 */
export function hiddenColumnNamesOf(columns: BoardColumn[], visibleColumnIds: string[]): string[] {
    const visible = new Set(visibleColumnIds);
    return columns.filter((column) => !visible.has(column.id)).map((column) => column.name);
}

/**
 * 设置里没有命中任何一列的条目。
 *
 * 手填列名最容易拼错，而拼错的表现是「设置像是没生效」，比报错更难查；
 * 调用方把这份名单变成一条提示。
 * 列定义还没拿到时不做判断，避免首屏误报成配置错误。
 */
export function unmatchedHiddenColumns(columns: BoardColumn[], hidden: string[]): string[] {
    if (columns.length === 0 || hidden.length === 0) {
        return [];
    }
    const known = new Set(columns.flatMap((column) => [normalize(column.name), normalize(column.id)]));
    return hidden.filter((value) => normalize(value).length > 0 && !known.has(normalize(value)));
}
