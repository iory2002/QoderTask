import * as https from 'https';
import * as tls from 'tls';

/**
 * 内网主机的证书主机名与 SAN 对不上：
 * 请求 ulsgi-bm.lab.ge-healthcare.net，证书 SAN 只有 ulsgi-bm.avs.uswau.lab.ge-healthcare.net。
 * 链校验照常进行，只放行主机名比对这一项。
 *
 * 链校验不能依赖启动参数：内网服务端只下发叶子证书，中间证书
 * （GE HealthCare Server CA 1 G2）只在 Windows 的 CurrentUser\CA 里，
 * 而 Node 默认不读系统证书库。这里在运行时用 tls.getCACertificates('system')
 * 把系统库拼进 ca，双击 QoderCN.exe 启动也能验链。
 *
 * getCACertificates 需要 Node >= 22.15；更老的运行时返回空，行为退回默认
 * （此时仍需 NODE_USE_SYSTEM_CA=1，见 run-qodercn.cmd）。
 */
function loadTrustAnchors(): string[] {
    const getCACertificates = (tls as unknown as {
        getCACertificates?: (type: 'default' | 'system' | 'extra') => string[];
    }).getCACertificates;
    if (typeof getCACertificates !== 'function') {
        return [];
    }

    const anchors: string[] = [];
    // 传了 ca 就会替换默认根，所以自带根和系统根都要显式带上
    for (const type of ['default', 'system'] as const) {
        try {
            anchors.push(...getCACertificates.call(tls, type));
        } catch {
            // 某些 Node 版本不认 'default' / 'system'，跳过即可
        }
    }
    return anchors;
}

const trustAnchors = loadTrustAnchors();

/** 策略放在请求级选项里而不是只挂 agent：请求级优先级高于 agent，宿主即便改走全局 agent 也照样生效。 */
export const intranetTlsOptions: https.AgentOptions = {
    checkServerIdentity: () => undefined,
    ...(trustAnchors.length > 0 ? { ca: trustAnchors } : {})
};

/** 内网专用的 https agent */
export function createIntranetHttpsAgent(): https.Agent {
    return new https.Agent(intranetTlsOptions);
}
