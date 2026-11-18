/**
 * Jira Server OAuth 1.0a 一次性授权（3-legged）。
 *
 * 用途：用本机 RSA 私钥向 Jira 申请 request token，打开浏览器让对方点 Allow，
 * 收到 oauth_verifier 后换长期 access token，加密写回 ~/.scrumbuddy/config.json。
 *
 * 前置条件（Jira 管理员侧，只需做一次）：
 *   Application Links → Create incoming link
 *   Consumer Key      = qodertask-jira
 *   Consumer Name     = QoderTask
 *   Public Key        = ~/.scrumbuddy/jira-oauth-public.pem 的内容
 *   Application URL   = http://127.0.0.1:53134  ← 同时充当回调地址
 *
 * 用法：
 *   node scripts/jira-oauth-authorize.js
 *   node scripts/jira-oauth-authorize.js --base-url http://pc-jira.apps.ge-healthcare.net:8080
 *   node scripts/jira-oauth-authorize.js --port 53134 --consumer-key qodertask-jira
 *
 * 授权时浏览器里登录的必须是你要用的那个 Jira 账号：token 绑定授权者的权限。
 */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');

const CONFIG_PATH = path.join(os.homedir(), '.scrumbuddy', 'config.json');
const DEFAULT_CONSUMER_KEY = 'qodertask-jira';
const DEFAULT_PORT = 53134;
const DEFAULT_PRIVATE_KEY = path.join(os.homedir(), '.scrumbuddy', 'jira-oauth-private.pem');

function parseArgs(argv) {
    const args = { port: DEFAULT_PORT, consumerKey: DEFAULT_CONSUMER_KEY, privateKeyPath: DEFAULT_PRIVATE_KEY };
    for (let i = 0; i < argv.length; i += 1) {
        const key = argv[i];
        const value = argv[i + 1];
        if (key === '--base-url') {
            args.baseUrl = value;
            i += 1;
        } else if (key === '--port') {
            args.port = Number(value);
            i += 1;
        } else if (key === '--consumer-key') {
            args.consumerKey = value;
            i += 1;
        } else if (key === '--private-key') {
            args.privateKeyPath = value;
            i += 1;
        }
    }
    return args;
}

function readConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        throw new Error(`找不到配置文件：${CONFIG_PATH}`);
    }
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function writeConfig(config) {
    const backup = `${CONFIG_PATH}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(CONFIG_PATH, backup);
    fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
    return backup;
}

/** 与 scrum-buddy 完全一致的 AES-256-GCM 加密，宿主程序可直接解密 */
function encrypt(text) {
    if (!text || text.startsWith('enc:')) {
        return text;
    }
    const seed = `${os.userInfo().username}@${os.hostname()}:scrumbuddy`;
    const key = crypto.scryptSync(seed, 'scrumbuddy-salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `enc:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/** RFC 3986：encodeURIComponent 不编码的 !'()* 也必须编码，否则签名不匹配 */
function percentEncode(value) {
    return encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * 生成 OAuth 1.0a Authorization 头（RSA-SHA1）。
 * 注意：JSON body 不参与签名，只有 query 参数和 form body 才进 base string。
 */
function buildAuthHeader(method, urlString, extraOAuthParams, privateKey) {
    const url = new URL(urlString);
    const oauthParams = {
        oauth_consumer_key: extraOAuthParams.oauth_consumer_key,
        oauth_nonce: crypto.randomBytes(16).toString('hex'),
        oauth_signature_method: 'RSA-SHA1',
        oauth_timestamp: String(Math.floor(Date.now() / 1000)),
        oauth_version: '1.0',
    };
    for (const [key, value] of Object.entries(extraOAuthParams)) {
        if (key !== 'oauth_consumer_key') {
            oauthParams[key] = value;
        }
    }

    const allParams = { ...oauthParams };
    for (const [key, value] of url.searchParams) {
        allParams[key] = value;
    }

    const normalized = Object.keys(allParams)
        .sort()
        .map((key) => `${percentEncode(key)}=${percentEncode(allParams[key])}`)
        .join('&');

    const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
    const baseString = [method.toUpperCase(), percentEncode(baseUrl), percentEncode(normalized)].join('&');
    const signature = crypto.createSign('RSA-SHA1').update(baseString).sign(privateKey, 'base64');

    const fields = Object.entries(oauthParams).map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`);
    fields.push(`oauth_signature="${percentEncode(signature)}"`);
    return `OAuth ${fields.join(', ')}`;
}

function requestTokenUrl(baseUrl) {
    return { url: new URL('/plugins/servlet/oauth/request-token', baseUrl), method: 'POST' };
}

function postForm(url, authHeader) {
    return new Promise((resolve, reject) => {
        const transport = url.protocol === 'https:' ? https : http;
        const req = transport.request(
            {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    Authorization: authHeader,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': 0,
                    Accept: 'application/x-www-form-urlencoded',
                },
                timeout: 30000,
            },
            (res) => {
                let body = '';
                res.on('data', (chunk) => {
                    body += chunk;
                });
                res.on('end', () => resolve({ status: res.statusCode || 0, body: body.trim() }));
            }
        );
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('请求超时'));
        });
        req.end();
    });
}

function openBrowser(url) {
    const command = process.platform === 'win32' ? `start "" "${url}"` : `open "${url}"`;
    exec(command, () => {
        /* 打不开就让用户手动点打印出来的链接 */
    });
}

function respond(res, status, html) {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const config = readConfig();
    const baseUrl = (args.baseUrl || config?.jira?.baseUrl || '').replace(/\/+$/, '');
    if (!baseUrl) {
        throw new Error('缺少 Jira 地址：用 --base-url 指定，或在 config.json 里配置 jira.baseUrl');
    }
    if (!/^http:\/\/127\.0\.0\.1|^http:\/\/localhost/.test(baseUrl) && !/^https?:/.test(baseUrl)) {
        throw new Error(`Jira 地址不合法：${baseUrl}`);
    }
    if (!fs.existsSync(args.privateKeyPath)) {
        throw new Error(`找不到私钥：${args.privateKeyPath}\n先运行密钥生成步骤，或用 --private-key 指定路径`);
    }

    const privateKey = fs.readFileSync(args.privateKeyPath, 'utf-8');
    const callbackUrl = `http://127.0.0.1:${args.port}`;

    console.log(`Jira      : ${baseUrl}`);
    console.log(`Consumer  : ${args.consumerKey}`);
    console.log(`Callback  : ${callbackUrl}`);
    console.log(`私钥      : ${args.privateKeyPath}`);
    console.log('');

    // 1. 申请 request token
    const { url: reqTokenUrl, method } = requestTokenUrl(baseUrl);
    const reqAuth = buildAuthHeader(
        method,
        reqTokenUrl.toString(),
        { oauth_consumer_key: args.consumerKey, oauth_callback: callbackUrl },
        privateKey
    );
    const tokenRes = await postForm(reqTokenUrl, reqAuth);
    if (tokenRes.status !== 200) {
        const hint =
            tokenRes.body.includes('consumer_key_unknown')
                ? '\n→ Jira 上没注册这个 consumer key：检查 Application Link 的 Incoming OAuth 配置'
                : tokenRes.body.includes('signature')
                  ? '\n→ 签名被拒：Jira 上的 Public Key 与本机私钥不配对'
                  : '';
        throw new Error(`申请 request token 失败（${tokenRes.status}）：${tokenRes.body}${hint}`);
    }

    const reqParams = new URLSearchParams(tokenRes.body);
    const requestToken = reqParams.get('oauth_token') || '';
    const requestSecret = reqParams.get('oauth_token_secret') || '';
    if (!requestToken) {
        throw new Error(`request token 响应异常：${tokenRes.body}`);
    }

    const authorizeUrl = `${baseUrl}/plugins/servlet/oauth/authorize?oauth_token=${encodeURIComponent(requestToken)}`;

    // 2. 起本地回调服务
    const server = http.createServer(async (req, res) => {
        const incoming = new URL(req.url || '/', callbackUrl);
        const verifier = incoming.searchParams.get('oauth_verifier');
        const denied = incoming.searchParams.get('denied');
        if (denied) {
            respond(res, 403, '<h3>授权被拒绝</h3><p>浏览器里点了 Deny，可关闭此页后重新运行脚本。</p>');
            console.error('\n授权被拒绝（Deny）。');
            server.close();
            process.exitCode = 1;
            return;
        }
        if (!verifier) {
            respond(res, 400, '<h3>缺少 oauth_verifier</h3>');
            return;
        }

        try {
            // 3. 换长期 access token
            const accessUrl = new URL('/plugins/servlet/oauth/access-token', baseUrl);
            const accessAuth = buildAuthHeader(
                'POST',
                accessUrl.toString(),
                {
                    oauth_consumer_key: args.consumerKey,
                    oauth_token: requestToken,
                    oauth_verifier: verifier,
                },
                privateKey
            );
            const accessRes = await postForm(accessUrl, accessAuth);
            if (accessRes.status !== 200) {
                throw new Error(`换取 access token 失败（${accessRes.status}）：${accessRes.body}`);
            }
            const access = new URLSearchParams(accessRes.body);
            const accessToken = access.get('oauth_token') || '';
            const accessSecret = access.get('oauth_token_secret') || '';
            if (!accessToken) {
                throw new Error(`access token 响应异常：${accessRes.body}`);
            }

            // 4. 加密写回配置
            config.jira = config.jira || {};
            config.jira.oauth = {
                consumerKey: args.consumerKey,
                consumerName: 'QoderTask',
                privateKeyPath: args.privateKeyPath,
                callbackUrl,
                requestTokenSecret: requestSecret ? encrypt(requestSecret) : '',
                token: encrypt(accessToken),
                tokenSecret: encrypt(accessSecret),
                authorizedAt: new Date().toISOString(),
            };
            const backup = writeConfig(config);

            console.log('\n授权成功。');
            console.log(`access token 已加密写入 ${CONFIG_PATH}`);
            console.log(`原配置备份：${backup}`);
            respond(
                res,
                200,
                '<h3>授权成功</h3><p>可以关闭此页面，回到终端继续。</p>'
            );
        } catch (error) {
            console.error('\n', error instanceof Error ? error.message : error);
            respond(res, 500, `<h3>授权失败</h3><p>${String(error)}</p>`);
            process.exitCode = 1;
        } finally {
            server.close();
        }
    });

    server.listen(args.port, '127.0.0.1', () => {
        console.log('等待授权...');
        console.log(`如浏览器未自动打开，手动访问：\n${authorizeUrl}\n`);
        console.log('⚠ 页面上点 Allow 之前，确认右上角是你自己的 Jira 账号（不是管理员）。');
        openBrowser(authorizeUrl);
    });

    server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.error(`端口 ${args.port} 已被占用，用 --port 换一个（同时要改 Jira 上的 Application URL）。`);
        } else {
            console.error(error.message);
        }
        process.exitCode = 1;
    });
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
