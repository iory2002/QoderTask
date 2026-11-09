/**
 * 验证「只看我的」本地过滤的身份匹配：/myself 的 name/key 是否等于 issue.fields.assignee.name。
 * 跑法：node .scratch/jira-board-impl/probe-mine.js
 */
const { loadScrumBuddyConfig } = require('../../out/services/ScrumBuddyConfig.js');

const jira = loadScrumBuddyConfig().jira;
const base = String(jira.baseUrl).replace(/\/+$/, '');
const auth = 'Basic ' + Buffer.from(`${jira.username}:${jira.password}`).toString('base64');
const enc = encodeURIComponent;

async function jget(path) {
    const res = await fetch(base + path, { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    if (res.status >= 400) throw new Error(`HTTP ${res.status} ${path}`);
    return JSON.parse(text);
}

(async () => {
    const me = await jget('/rest/api/2/myself');
    console.log(`myself: name=${me.name}  key=${me.key}  displayName=${me.displayName}`);

    const cfgName = me.key ?? me.name; // 与 JiraService.getMyself 的取值一致
    const jql = 'sprint = 521 AND project IN (NEX2) AND issuetype != Epic ORDER BY Rank ASC';
    const r = await jget(`/rest/api/2/search?jql=${enc(jql)}&fields=assignee,status,issuetype&maxResults=200`);

    const mine = r.issues.filter((i) => String(i.fields.assignee?.name ?? '') === cfgName);
    console.log(`\nsprint 521 ∩ NEX2 共 ${r.total} 条，用 assignee.name === "${cfgName}" 命中 ${mine.length} 条：`);
    for (const i of mine) {
        console.log(`  ${i.key.padEnd(11)} ${String(i.fields.status?.name).padEnd(16)} ${i.fields.assignee?.displayName}`);
    }

    // 反向检查：有没有 assignee.key 才是用户名的情形
    const byKey = r.issues.filter((i) => String(i.fields.assignee?.key ?? '') === cfgName);
    console.log(`\n用 assignee.key 比对命中 ${byKey.length} 条`);
})();
