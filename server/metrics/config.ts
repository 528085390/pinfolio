import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from '../db.js'
import { mergeMetricsFile, parseHosts, type HostMeta } from './hostmeta.js'

// 指标源：6 台机各自把 JSON PUT 到 my-server 的 nginx（见 tools/node-metrics/），
// 本机再从那个只读目录把文件拉回来。token 与 base 都写在 data/metrics.json（不入库、不进 git）。
// 这个文件是主机清单的唯一真相：页面上的增 / 暂停 / 删最终都写回它（saveHosts）。
export type { HostMeta } from './hostmeta.js'
export type MetricsConfig = { base: string; hosts: HostMeta[] }

// 没配 data/metrics.json 时的兜底清单（只有名字，没有地址 —— 地址必须显式配置）
const DEFAULT_HOSTS: HostMeta[] = [
  { id: 'my-server', label: 'my-server', note: '阿里云 · 北京' },
  { id: 'az', label: 'az', note: 'Azure · 美中' },
  { id: 'oj', label: 'oj', note: 'Oracle · 东京' },
  { id: 'os', label: 'os', note: 'Oracle · 东京' },
  { id: 'ox', label: 'ox', note: 'Oracle · 东京' },
  { id: 'aws', label: 'aws', note: 'AWS · 俄勒冈' },
]

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
