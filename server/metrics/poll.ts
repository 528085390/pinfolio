import { t } from '../i18n.js'
import { metricsConfig } from './config.js'
import { pruneOld, saveSample } from './store.js'

// 拉取：指标源上是每台机一个静态 JSON（nginx dav 写、nginx 只读），本机每 5 分钟全拉一遍。
// 拉取失败不清空已有数据 —— 页面靠 staleSec 自己判断新旧，比删数据好。
export type PollResult = { at: number; ok: number; failed: { id: string; error: string }[] }

const POLL_MS = 5 * 60 * 1000
// 页面每次刷新都会顺带催一次拉取，但真正的数据 5 分钟才更新一次，
// 所以这里卡 4 分钟：定时器（5 分钟）永远能过，页面刷新基本白跑一趟，不额外打指标源。
const MIN_GAP_MS = 4 * 60 * 1000
const FETCH_TIMEOUT_MS = 8000

let last: PollResult = { at: 0, ok: 0, failed: [] }
let inflight: Promise<PollResult> | null = null

export function lastPoll(): PollResult {
  return last
}

export async function pollAll(force = false): Promise<PollResult> {
  if (inflight) return inflight
  const cfg = metricsConfig()
  if (!cfg.base) {
    last = { at: Date.now(), ok: 0, failed: [{ id: '*', error: t('没配指标源 base（data/metrics.json）') }] }
    return last
  }
  if (!force && Date.now() - last.at < MIN_GAP_MS) return last

  // 暂停的主机保留卡片和历史，只是不再拉取（采集端还在往指标源推，恢复后补到最新一帧）
  const active = cfg.hosts.filter((h) => !h.paused)

  inflight = (async () => {
    const results = await Promise.all(
      active.map(async (h) => {
        try {
          const res = await fetch(cfg.base + encodeURIComponent(h.id) + '.json', {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: { 'cache-control': 'no-cache' },
          })
          if (!res.ok) throw new Error('HTTP ' + res.status)
          const j: any = await res.json()
          if (!j || typeof j.ts !== 'number' || typeof j.host !== 'string') throw new Error(t('不是指标 JSON'))
          saveSample(h.id, Math.floor(j.ts), j)
          return null
        } catch (e: any) {
          const msg = String(e?.name === 'TimeoutError' ? t('超时') : e?.message || e)
          return { id: h.id, error: msg }
        }
      }),
    )
    const failed = results.filter((r): r is { id: string; error: string } => r !== null)
    last = { at: Date.now(), ok: active.length - failed.length, failed }
    try {
      pruneOld(30)
    } catch (e) {
      console.error('[metrics] 清理旧数据失败', e)
    }
    return last
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}

let bootTimer: NodeJS.Timeout | null = null
let timer: NodeJS.Timeout | null = null

/** 关服务时调：停掉开机首拉与 5 分钟周期（重复调用无害）。 */
export function stopMetricsPoller(): void {
  if (bootTimer) clearTimeout(bootTimer)
  if (timer) clearInterval(timer)
  bootTimer = null
  timer = null
}

/**
 * 服务启动时挂上：开机 3 秒拉一次，之后每 5 分钟一次。
 * 返回 stop（startServer 收集起来、close() 时调）；已经在跑时不会再挂第二份。
 */
export function startMetricsPoller(): () => void {
  if (timer) return stopMetricsPoller
  const tick = () => {
    void pollAll().catch((e) => console.error('[metrics] 拉取失败', e))
  }
  bootTimer = setTimeout(tick, 3000)
  bootTimer.unref?.()
  timer = setInterval(tick, POLL_MS)
  timer.unref?.()
  return stopMetricsPoller
}
