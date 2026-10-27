import { kickCheck, listMonitors } from './client.js'

// 切换全局出站模式之后，把「本来就在跑」的观测项立刻重探一遍：
// 用户刚把直连改成代理（或反过来），不想等下一个 60 秒周期才知道哪一项在新链路上挂了。
//
// 三条硬约束（踩了会伤到用户）：
//   1. **只踢 active 且 SUPPORTED 的项**。kickCheck 底下是 kuma 的 resumeMonitor，它会顺手把
//      active 置回 1 —— 所以停用项必须在这里就筛掉，绝不能让「切换出站」把用户停用的观测项点亮。
//   2. 顺序踢，每条之间睡 100ms：一次并发几十条 resumeMonitor 会把 kuma 的 socket 和探测队列打满。
//   3. 单条失败只 console.warn，不抛：一条重启失败不该让整轮（以及整个 POST /api/outbound）失败。
// 日志里只有 id 和错误消息，永远不带观测项配置 / 请求体（里面有明文密码）。

/** 出站改造支持的类型；与 kuma 的 SUPPORTED 集合一致（push / group / manual / real-browser 不在内） */
const SUPPORTED = new Set(['http', 'keyword', 'json-query', 'ssh', 'sftp', 'port'])

/** 上一轮还在跑时直接复用（返回 0），不要叠一轮 */
let running = false

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 有没有一轮重探正在跑（路由用它决定 rechecking 该回几） */
export function isRechecking(): boolean {
  return running
}

/**
 * 选出这一轮要重探的 id：active 且类型受支持。
 * 只读，不改任何状态 —— 路由可以在真正开踢之前先拿到条数回给前端。
 */
export async function pickRecheckIds(): Promise<number[]> {
  const beans = await listMonitors()
  const ids: number[] = []
  for (const key of Object.keys(beans || {})) {
    const m = beans[key]
    if (!m || typeof m !== 'object') continue
    // active 在 kuma 的 bean 里是布尔，老数据可能是 0/1；两种都认
    if (m.active !== true && m.active !== 1) continue
    if (!SUPPORTED.has(String(m.type || ''))) continue
    const id = Number(m.id ?? key)
    if (Number.isInteger(id) && id > 0) ids.push(id)
  }
  // 按 id 升序：重探顺序稳定，排查时日志好对
  return ids.sort((a, b) => a - b)
}

/** 依次踢一遍；返回实际成功踢出去的条数。running 为真时直接返回 0（不叠轮）。 */
export function kickInBackground(ids: number[]): number {
  if (running || !ids.length) return 0
  running = true
  void (async () => {
    let kicked = 0
    try {
      for (const id of ids) {
        try {
          await kickCheck(id)
          kicked += 1
        } catch (e: any) {
          // 只打 id 与错误消息：错误文案来自 kuma，不含密码；别把观测项配置打出来
          console.warn('[outbound] 重探 #' + id + ' 失败：' + String(e?.message || e))
        }
        await sleep(100)
      }
    } finally {
      running = false
      if (kicked !== ids.length) console.warn('[outbound] 本轮重探 ' + kicked + '/' + ids.length + ' 条成功')
    }
  })()
  return ids.length
}

/**
 * 一轮完整重探：选 id → 后台踢。
 * 返回「这轮踢了几条」，0 表示上一轮还在跑（被互斥挡掉）或者没有可踢的项。
 */
export async function recheckAll(): Promise<number> {
  const ids = await pickRecheckIds()
  return kickInBackground(ids)
}
