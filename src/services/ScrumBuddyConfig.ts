import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const ENCRYPTED_PREFIX = 'enc:';

/**
 * 与 scrum-buddy encryption.js 保持一致的解密逻辑
 * 算法: aes-256-gcm, key 派生自 `${username}@${hostname}:scrumbuddy`
 */
function getDecryptionKey(): Buffer {
    const seed = `${os.userInfo().username}@${os.hostname()}:scrumbuddy`;
    return crypto.scryptSync(seed, 'scrumbuddy-salt', 32);
}

/**
 * 解密 scrum-buddy 的 enc: 前缀密文，明文原样返回
 */
export function decryptValue(text: string): string {
    if (!text || !text.startsWith(ENCRYPTED_PREFIX)) {
        return text;
    }
    try {
        const payload = text.slice(ENCRYPTED_PREFIX.length);
        const [ivHex, authTagHex, encryptedHex] = payload.split(':');
        if (!ivHex || !authTagHex || !encryptedHex) {
            return text;
        }
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const encrypted = Buffer.from(encryptedHex, 'hex');
        const key = getDecryptionKey();
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch {
        return text;
    }
}

/**
 * 需要解密的一级敏感字段
 */
const SENSITIVE_FIELDS: string[] = ['password', 'token'];

/**
 * 嵌套在子对象里的敏感字段。`sb-agent authorize` 把 Jira token 写在
 * `jira.oauth.token`，只看一级字段会把密文原样当 token 用。
 */
const NESTED_SENSITIVE_FIELDS: Array<{ parent: string; keys: string[] }> = [
    { parent: 'oauth', keys: ['token', 'tokenSecret', 'requestTokenSecret'] },
];

function decryptInPlace(holder: Record<string, any>, key: string): void {
    if (typeof holder[key] === 'string' && holder[key].startsWith(ENCRYPTED_PREFIX)) {
        holder[key] = decryptValue(holder[key]);
    }
}

function decryptSection(section: Record<string, any>): void {
    for (const key of SENSITIVE_FIELDS) {
        decryptInPlace(section, key);
    }
    for (const { parent, keys } of NESTED_SENSITIVE_FIELDS) {
        const child = section[parent];
        if (!child || typeof child !== 'object') {
            continue;
        }
        for (const key of keys) {
            decryptInPlace(child, key);
        }
    }
}

/**
 * 读取 ~/.scrumbuddy/config.json，自动解密 enc: 前缀的敏感字段
 * 每次调用都重新读取文件，确保获取最新配置
 */
export function loadScrumBuddyConfig(): Record<string, any> | null {
    const configPath = path.join(os.homedir(), '.scrumbuddy', 'config.json');
    if (!fs.existsSync(configPath)) {
        console.warn('ScrumBuddy config not found:', configPath);
        return null;
    }
    try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(raw);
        // 解密所有平台的敏感字段
        for (const platform of Object.keys(config)) {
            const section = config[platform];
            if (section && typeof section === 'object') {
                decryptSection(section);
            }
        }
        return config;
    } catch (err) {
        console.error('Failed to load ScrumBuddy config:', err);
        return null;
    }
}
