import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from '../db.js'
import { loadKey } from '../secrets/key.js'
import { readSecret } from '../secrets/crypto.js'
import { mergeMetricsFile, parseHosts, type HostMeta } from './hostmeta.js'

// 指标源：各台机把自己的 JSON PUT 到一台带 nginx 的服务器（见 tools/node-metrics/），
// 本机再从那个只读目录把文件拉回来。token 与 base 都写在 data/metrics.json（不入库、不进 git）。
// 这个文件是主机清单的唯一真相：页面上的增 / 暂停 / 删最终都写回它（saveHosts）。
export type { HostMeta } from './hostmeta.js'
export type MetricsConfig = { base: string; hosts: HostMeta[] }

// 没配 data/metrics.json 时的兜底：空清单（地址必须显式配置，不能替使用者假设有哪几台机）
const DEFAULT_HOSTS: HostMeta[] = []

let cached: MetricsConfig | null = null

function configFile(): string {
  return join(DATA_DIR, 'metrics.json')
}

/** 读原始 JSON：文件不存在 / 写坏了都回空对象，让上层退到兜底而不是整个崩掉。 */
function readRaw(): any {
  try {
    return JSON.parse(readFileSync(configFile(), 'utf8'))
  } catch {
    return {}
  }
}

export function metricsConfig(): MetricsConfig {
  if (cached) return cached
  let base = process.env.PINBOARD_METRICS_BASE || ''
  let hosts = DEFAULT_HOSTS
  const j = readRaw()
  if (j && typeof j.base === 'string' && j.base.trim()) base = j.base.trim()
  // base 里带采集 token，落盘时是密文（spec 03）；解不开就当没配，主机页显示「拉取失败」而不是整个崩
  try {
    base = base ? readSecret(base, loadKey(DATA_DIR)) : ''
  } catch (e) {
    console.error('[metrics] 指标源地址解密失败（主密钥可能变了）:', String(e))
    base = ''
  }
  // 文件里显式给了 hosts（哪怕是空数组）就听文件的：
  // 把主机删光了不该让默认 6 台又冒出来，否则「删除」等于删不掉。
  if (j && Array.isArray(j.hosts)) hosts = parseHosts(j.hosts)
  cached = { base: base ? base.replace(/\/+$/, '') + '/' : '', hosts }
  return cached
}

/** 改了 data/metrics.json 之后不用重启，下一次读配置重新加载。 */
export function resetMetricsConfig() {
  cached = null
}

/**
 * 写回主机清单：只换 hosts，base（带 token）和其它未知键原样保留 —— 否则「加一台机」
 * 就会把指标源地址弄丢。先写临时文件再 rename，写一半断电也不会留下半个 JSON。
 */
export function saveHosts(hosts: HostMeta[]): HostMeta[] {
  const file = configFile()
  const next = mergeMetricsFile(readRaw(), hosts)
  mkdirSync(DATA_DIR, { recursive: true })
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
  resetMetricsConfig()
  return metricsConfig().hosts
}
