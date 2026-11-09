/**
 * 评审交接的指令文本。
 *
 * Qoder 的聊天面板没有对外的「新建会话并预填」命令（见 ADR 0001），
 * 扩展能做的最后一公里就是把一条可直接发送的指令放进剪贴板。
 * 指令里必须写死「只审这个 MR、不要审当前工作区」——否则 /code-review
 * 会去审当前仓库的 git diff，而那和这个 MR 毫无关系。
 */

export interface ReviewTarget {
    iid: number;
    title: string;
    url: string;
}

export function buildReviewRequest(target: ReviewTarget, diffPath?: string): string {
    const head = `/code-review 审查 GitLab MR !${target.iid}（${target.title}），链接 ${target.url}`;
    if (diffPath) {
        return `${head}，diff 已保存到 ${diffPath}。只审这个 MR 的改动，不要审当前工作区。`;
    }
    return `${head}。用 scrum-buddy 的 gitlab_get_mr_diff 取 diff，只审这个 MR 的改动，不要审当前工作区。`;
}

