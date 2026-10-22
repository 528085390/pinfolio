import { join } from 'node:path'

// 采集端接入的纯逻辑：把 data/metrics.json 的 base 换算成采集端要 PUT 的地址、
// 解析「服务清单 / 磁盘路径」、拼那条贴进终端就能跑的安装命令。
// 命令里的每个参数都过 shq()，所以单元名/路径里就算有空格或引号也不会跑偏。
const UNIT_RE = /^[A-Za-z0-9@:._-]+$/
const MAX_UNITS = 16
const MAX_DISKS = 8
/** 安装器下载到目标机的临时路径（安装器自己跑完会清掉临时目录，这份留着无妨）。 */
export const INSTALL_PATH = '/tmp/node-metrics-install.sh'
/** 安装器公网地址（my-server 的 nginx /nm/ 托管，不带 token）。 */
export const INSTALL_URL = 'https://203.0.113.10/nm/node-metrics-install.sh'

/**
 * base 是「拉取」用的地址（https://host/metrics/<token>/），
 * 采集端要 PUT 到 /metrics-ingest/<token>（nginx 那边只允许 PUT）。
 */
export function buildIngestUrl(base: string): string {
  const trimmed = String(base ?? '').trim()
  if (!trimmed) throw new Error('metrics base 为空，无法生成上报地址')
  const marker = '/metrics/'
  const cut = trimmed.indexOf(marker)
  if (cut < 0) throw new Error('metrics base 里没有 /metrics/ 段，无法生成上报地址')
  const token = trimmed.slice(cut + marker.length).replace(/\/+$/, '')
  if (!token) throw new Error('metrics base 里没有 token，无法生成上报地址')
  return trimmed.slice(0, cut) + '/metrics-ingest/' + token
}

/** 服务清单（WATCH_UNITS）：空格 / 逗号分隔，去重保序，非法字符直接报错。 */
export function parseUnits(text?: string | null): string[] {
  const out: string[] = []
  for (const raw of String(text ?? '').split(/[\s,]+/)) {
    const unit = raw.trim()
    if (!unit) continue
    if (!UNIT_RE.test(unit)) throw new Error('单元名只能用字母、数字、@ : . _ -：' + unit)
    if (!out.includes(unit)) out.push(unit)
  }
  if (out.length > MAX_UNITS) throw new Error('服务清单最多 ' + MAX_UNITS + ' 个')
  return out
}

/** 磁盘路径（DISK_PATHS）：空格分隔，必须绝对路径；空输入回落 "/"。 */
export function parseDisks(text?: string | null): string[] {
  const out: string[] = []
  for (const raw of String(text ?? '').split(/[\s,]+/)) {
    const p = raw.trim()
    if (!p) continue
    if (!p.startsWith('/') || /\s/.test(p)) throw new Error('磁盘路径要以 / 开头，且不能含空格：' + p)
    if (!out.includes(p)) out.push(p)
  }
  if (out.length > MAX_DISKS) throw new Error('磁盘路径最多 ' + MAX_DISKS + ' 个')
  return out.length ? out : ['/']
}

/** 单引号转义：shq("a'b") → 'a'\''b'。 */
export function shq(value: string): string {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

export type InstallCommandInput = {
  installUrl: string
  ingestUrl: string
  hostId: string
  units: string[]
  disks: string[]
}

/**
 * 一条能直接粘贴的命令：先下载单文件安装器，再 sudo 安装。
 * 四个位置参数一个都不能省（省了磁盘路径会顶到服务清单位）。
 */
export function buildInstallCommand(input: InstallCommandInput): string {
  const units = (input.units || []).join(' ')
  const disks = (input.disks && input.disks.length ? input.disks : ['/']).join(' ')
  const args = [input.ingestUrl, input.hostId, units, disks].map((v) => shq(String(v ?? '')))
  return 'curl -fsSL ' + shq(input.installUrl || INSTALL_URL) + ' -o ' + INSTALL_PATH
    + ' && sudo bash ' + INSTALL_PATH + ' ' + args.join(' ')
}

/** 采集端装上之后，它自己会读 /etc/node-metrics.conf；这里只是给文档/提示用的相对路径。 */
export function confPath(): string {
  return join('/etc', 'node-metrics.conf')
}
