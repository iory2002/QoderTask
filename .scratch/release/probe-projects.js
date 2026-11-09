/**
 * 只读探针：看看当前 token 在 GitLab 上能看到哪些项目、能否作为发布目标。
 * 跑法：node .scratch/release/probe-projects.js
 */
const https = require('https');
const http = require('http');
const { loadScrumBuddyConfig } = require('../../out/services/ScrumBuddyConfig');
const { createIntranetHttpsAgent, intranetTlsOptions } = require('../../out/services/intranetTls');

const config = loadScrumBuddyConfig();
const gitlab = config && config.gitlab;

if (!gitlab || !gitlab.baseUrl || !gitlab.token) {
    console.error('没有可用的 gitlab 配置');
    process.exit(1);
}

function get(pathname) {
    return new Promise((resolve, reject) => {
        const url = new URL(pathname, gitlab.baseUrl.replace(/\/+$/, ''));
        const isHttps = url.protocol === 'https:';
        const transport = isHttps ? https : http;
        const req = transport.request(
            {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                method: 'GET',
                headers: { 'PRIVATE-TOKEN': gitlab.token, Accept: 'application/json' },
                timeout: 15000,
                ...(isHttps ? { agent: createIntranetHttpsAgent(), ...intranetTlsOptions } : {}),
            },
            (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const body = Buffer.concat(chunks).toString('utf-8');
                    if (res.statusCode >= 400) {
                        reject(new Error(`${res.statusCode} ${body.slice(0, 200)}`));
                        return;
                    }
                    resolve(JSON.parse(body));
                });
            }
        );
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('timeout'));
        });
        req.end();
    });
}

(async () => {
    const me = await get('/api/v4/user');
    console.log(`user = ${me.username} (${me.id})`);
    console.log(`can_create_project = ${me.can_create_project}, can_create_group = ${me.can_create_group}`);

    const groups = await get('/api/v4/groups?min_access_level=30&per_page=50&order_by=name');
    console.log(`groups (>= developer) -> ${groups.length}`);
    for (const group of groups) {
        console.log(`  ${group.full_path}  id=${group.id}  access=${group.access_level ?? 'n/a'}`);
    }

    const queries = ['todo-panel', 'qoder', 'pc-board'];
    for (const query of queries) {
        const projects = await get(
            `/api/v4/projects?membership=true&per_page=20&search=${encodeURIComponent(query)}`
        );
        console.log(`\nsearch "${query}" -> ${projects.length}`);
        for (const project of projects) {
            console.log(
                `  ${project.path_with_namespace}  id=${project.id}  visibility=${project.visibility}` +
                    `  permissions=${JSON.stringify(project.permissions || {})}`
            );
        }
    }

    const owned = await get('/api/v4/projects?owned=true&per_page=20&order_by=updated_at');
    console.log(`\nowned projects -> ${owned.length}`);
    for (const project of owned) {
        console.log(`  ${project.path_with_namespace}  id=${project.id}`);
    }
})().catch((error) => {
    console.error('probe failed:', error.message);
    process.exit(1);
});
