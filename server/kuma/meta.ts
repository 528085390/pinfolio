import { listMonitors } from './client.js'
import { kumaPass } from './secret.js'

// 观测页与 Kuma 之间只有两件事会因部署方式不同而不同，都不影响数据读取，只影响界面：
//   1. 连的是不是那个改造版 fork —— fork 在 monitor 上多了 policy_json 等字段，
//      上游原版没有；连到上游还渲染「立即观测」这类 fork 专属入口，用户点了只会报错。
//   2. 用户到底配没配 Kuma —— 没配就别在观测页报「连不上」，直接给一张怎么接的引导卡。
// 两者合成一个 GET /api/monitors/meta（monitorsRoute 挂在 /api/monitors 下），判定逻辑做成纯函数放这里，方便单测。

export type KumaFlavor = 'fork' | 'upstream'

/**
 * fork 版 monitor 上的扩展字段（上游原版没有）。任意一条带它就算 fork。
 * 注意是 **camelCase 的 policyJson**：库里的列叫 policy_json，但 monitor 的 toJSON
 * 走的是 camelCase（实测 getMonitorList 推回来的 bean 只有 policyJson）。
 */
export const FORK_FIELDS = ['policyJson', 'policy_json'] as const

/**
 * 判断连的是哪个版本（纯函数）：
 *   - 显式 `KUMA_FLAVOR=fork|upstream` 优先（自建改过的 Kuma 可能字段又不一样）；
 *   - 否则看任意一条 monitor 是否带 fork 的扩展字段；
 *   - 拿不到列表、空列表、字段缺失一律当 upstream —— 保守，宁可少显示功能，
 *     也不要在上游 Kuma 上渲染一个点下去必然报错的按钮。
 */
export function flavorOf(beans: unknown, override?: string): KumaFlavor {
  const forced = String(override ?? '').trim().toLowerCase()
  if (forced === 'fork' || forced === 'upstream') return forced
  if (!beans || typeof beans !== 'object') return 'upstream'
  const list = Array.isArray(beans) ? beans : Object.values(beans as Record<string, unknown>)
  for (const bean of list) {
    if (!bean || typeof bean !== 'object') continue
    const rec = bean as Record<string, unknown>
    if (FORK_FIELDS.some((f) => f in rec)) return 'fork'
  }
  return 'upstream'
}

/**
 * 配没配 Kuma（纯函数）：显式给了地址，或者有口令（口令可能来自 env / settings / data/kuma-pass.txt）。
 * 只给口令没给地址也算配了 —— 地址会退回默认的 http://127.0.0.1:3001。
 */
export function isConfigured(env: { url?: string; pass?: string } = {}): boolean {
  return !!(String(env.url ?? '').trim() || String(env.pass ?? '').trim())
}

/**
 * 最终判定（纯函数）：显式配置了就算配了 —— 哪怕此刻连不上，那是「连不上」不是「没配」，
 * 该让页面显示错误而不是引导卡；没显式配置时，再看默认地址上的状态页能不能读到
 * （观测页读的就是这个公开状态页，能读就等于能用，不该给用户看「还没接上」）。
 */
export function decideConfigured(env: { url?: string; pass?: string } = {}, reachable = false): boolean {
  return isConfigured(env) || reachable
}

/** 探一下公开状态页在不在（观测页的数据全从这里来）。只判 HTTP 状态，不解析。 */
async function statusPageReachable(timeoutMs = 3000): Promise<boolean> {
  const base = (process.env.KUMA_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '')
  const slug = process.env.KUMA_SLUG || 'obs'
  try {
    const res = await fetch(base + '/api/status-page/' + encodeURIComponent(slug), {
      signal: AbortSignal.timeout(timeoutMs),
    })
    return res.ok
  } catch {
    return false
  }
}

/* ---------------- 带缓存的运行时判定 ---------------- */

const FLAVOR_TTL = 5 * 60 * 1000
let flavorCache: { at: number; flavor: KumaFlavor } | null = null

/** 风味探测要连 Kuma 的 socket（只有它才给得出 monitor 的原始字段），失败按 upstream。 */
export async function kumaFlavor(): Promise<KumaFlavor> {
  const override = String(process.env.KUMA_FLAVOR ?? '').trim().toLowerCase()
  // 显式指定就不用探测了
  if (override === 'fork' || override === 'upstream') return override
  if (flavorCache && Date.now() - flavorCache.at < FLAVOR_TTL) return flavorCache.flavor
  let flavor: KumaFlavor = 'upstream'
  try {
    flavor = flavorOf(await listMonitors(), override)
  } catch {
    flavor = 'upstream'
  }
  flavorCache = { at: Date.now(), flavor }
  return flavor
}

/** 清掉风味缓存（改完 KUMA_URL 不用重启）。 */
export function resetFlavorCache() {
  flavorCache = null
}

export type KumaMeta = { configured: boolean; flavor: KumaFlavor; url: string }

export async function kumaMeta(): Promise<KumaMeta> {
  const url = (process.env.KUMA_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '')
  let pass = ''
  try { pass = kumaPass() } catch { /* 口令读不出来（密钥丢了等）就当没配 */ }
  const env = { url: process.env.KUMA_URL, pass }
  // 没显式配置时再探一次默认地址：本机已经跑着 Kuma 的人不该被塞一张「还没接上」
  const configured = decideConfigured(env, isConfigured(env) ? false : await statusPageReachable())
  if (!configured) return { configured: false, flavor: 'upstream', url }
  return { configured: true, flavor: await kumaFlavor(), url }
}
