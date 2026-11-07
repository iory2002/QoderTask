/**
 * 数据指纹：WebView 用它判断要不要重绘。
 * 纯函数、无 vscode 依赖，便于单测。
 */
export function fingerprint(input: string): string {
    let hash = 5381;
    for (let index = 0; index < input.length; index += 1) {
        hash = ((hash << 5) + hash + input.charCodeAt(index)) | 0;
    }
    return (hash >>> 0).toString(36);
}

/** 把 payload 归一化成可比较的字符串：字段顺序由调用方保证稳定 */
export function revisionOf(parts: Record<string, unknown>): string {
    return fingerprint(JSON.stringify(parts));
}
