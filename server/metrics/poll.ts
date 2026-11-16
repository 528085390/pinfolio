import { execFile } from 'node:child_process'
import { t } from '../i18n.js'
import { metricsConfig } from './config.js'
import { pruneOld, saveSample } from './store.js'

// 拉取：每台机一个 JSON，本机每 1 分钟全拉一遍。
//
// 两种指标源（base 的形式决定走哪条，2026-11-09 加 SSH）：
//   · ssh:<目录>   —— 例如 ssh:/var/lib/node-metrics。用本机 ssh 客户端
//                     `ssh <address|id> cat <目录>/<id>.json` 直接读，采集端只落盘，
//                     不占任何公网端口、不用证书（原 az 上的 nginx 收集端已随机器退役）
//   · http(s)://…  —— 老方式：采集端 PUT 到 nginx 的只读目录，本机再 GET 回来
//
// 拉取失败不清空已有数据 —— 页面靠 staleSec 自己判断新旧，比删数据好。
export type PollResult = { at: number; ok: number; failed: { id: string; error: string }[] }

const POLL_MS = 60 * 1000
// 页面每次刷新都会顺带催一次拉取，但真正的数据 1 分钟才更新一次，
// 所以这里卡 45 秒：定时器（1 分钟）永远能过，页面刷新基本白跑一趟，不额外打指标源。
const MIN_GAP_MS = 45 * 1000
const FETCH_TIMEOUT_MS = 8000
// SSH 要建连接 + 跑一条 cat，比 HTTP 慢一个量级；15 秒够连上东京/俄勒冈的机器
const SSH_TIMEOUT_MS = 15000
/** ssh 目标只允许这些字符（alias / user@host / IPv6 冒号），别让配置里的怪值拼进参数 */
const SSH_TARGET_RE = /^[A-Za-z0-9._@:\[\]-]+$/

let last: PollResult = { at: 0, ok: 0, failed: [] }
let inflight: Promise<PollResult> | null = null

export function lastPoll(): PollResult {
  return last
}

/** base 以 ssh: 开头就是 SSH 模式，冒号后面是采集端落盘目录。 */
export function isSshSource(base: string): boolean {
  return String(base ?? '').trim().startsWith('ssh:')
}

/** SSH 模式下每台机连谁：优先主机登记里的 address（ssh 别名或 user@host），没填就用 id。 */
export function sshTargetOf(host: { id: string; address?: string }): string {
  const target = String(host.address || host.id).trim()
  if (!SSH_TARGET_RE.test(target)) throw new Error(t('主机地址不能当 SSH 目标：{v}', { v: target }))
  return target
}

/** 把路径安全地拼进远端 sh 命令（路径来自管理员配置，仍不裸拼）。 */
function shellQuote(v: string): string {
  return "'" + String(v).replace(/'/g, "'\\''") + "'"
}

/** 一条 ssh 把对端那台机的 JSON cat 回来；refresh=true 时先让本机 timer 立即跑一次采集。 */
function readViaSsh(target: string, dir: string, id: string, refresh = false): Promise<string> {
  const file = String(dir || '').replace(/\/+$/, '') + '/' + id + '.json'
  // systemctl start 会等 oneshot 采集完再返回；sudo 不可用时静默退回读旧快照，
  // 不把「没有免密 sudo」误报成拉取失败。
  const remote = refresh
    ? `sudo -n systemctl start node-metrics.service >/dev/null 2>&1 || true; cat ${shellQuote(file)}`
    : `cat ${shellQuote(file)}`
  return new Promise((resolve, reject) => {
    execFile(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new', target, remote],
      { timeout: SSH_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = String(stderr || err.message || '')
            .trim()
            .split(/\r?\n/)
            .filter(Boolean)
            .pop()
          reject(new Error(msg || t('ssh 读取失败')))
          return
        }
        resolve(String(stdout ?? ''))
      },
    )
  })
}

export async function pollAll(force = false, collectFirst = false): Promise<PollResult> {
  if (inflight) return inflight
  const cfg = metricsConfig()
  if (!cfg.base) {
    last = { at: Date.now(), ok: 0, failed: [{ id: '*', error: t('没配指标源 base（data/metrics.json）') }] }
    return last
  }
  if (!force && Date.now() - last.at < MIN_GAP_MS) return last

  // 暂停的主机保留卡片和历史，只是不再拉取（采集端还在往指标源推，恢复后补到最新一帧）
  const active = cfg.hosts.filter((h) => !h.paused)

  const sshMode = isSshSource(cfg.base)
  const sshDir = sshMode ? cfg.base.trim().slice(4) : ''

  inflight = (async () => {
    const results = await Promise.all(
      active.map(async (h) => {
        try {
          let j: any
          if (sshMode) {
            j = JSON.parse(await readViaSsh(sshTargetOf(h), sshDir, h.id, collectFirst))
          } else {
            const res = await fetch(cfg.base + encodeURIComponent(h.id) + '.json', {
              signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
              headers: { 'cache-control': 'no-cache' },
            })
            if (!res.ok) throw new Error('HTTP ' + res.status)
            j = await res.json()
          }
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

/** 关服务时调：停掉开机首拉与 1 分钟周期（重复调用无害）。 */
export function stopMetricsPoller(): void {
  if (bootTimer) clearTimeout(bootTimer)
  if (timer) clearInterval(timer)
  bootTimer = null
  timer = null
}

/**
 * 服务启动时挂上：开机 3 秒拉一次，之后每 1 分钟一次。
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
