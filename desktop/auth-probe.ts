/**
 * 启动自检的探针（Task 10）：**有界重试 + 每次请求超时 + 失败诊断**。
 *
 * 要治的真实现象：打包好的 exe 在**第一次冷启动**（全新 userData、Defender 正在扫新 exe）时，
 * 服务已经打出 [pinfolio] listening on ... 之后，却因为一次 TypeError: fetch failed
 * 直接走到 boot().catch(...) → app.quit()，用户看到的就是「窗口一闪没了」。
 * 之后同样环境连跑 8 次以上都是绿的 ⇒ 这是连接层的一次性抖动，不是配置错。
 *
 * 三条设计约束（每一条都有对应的单测）：
 *
 * 1. **只有连接层失败才重试**：只有 fetch 自己抛错（ECONNREFUSED / 超时 abort / DNS 抖动）
 *    才算「还没连上」，才 sleep(300) 再试，最多 10 次。
 * 2. **拿到响应而状态码不是 401 → 立刻硬失败，绝不重试**：这不是网络问题，是**鉴权被削弱**
 *    （免密注入把守卫拆了 / 路由漏了鉴权 / 有人改了 server）。这种情况下重试 10 次只会
 *    把一个裸奔的窗口推迟 3 秒打开 —— 宁可启动失败也不要开。
 * 3. **每次请求都带 2s 超时**：不设超时的话，fetch 一旦挂住（半开连接、本机防火墙静默丢包），
 *    启动会永久卡在「建窗口之前」，用户看到「双击没反应、连窗口都没有」，比崩溃更糟。
 *
 * 失败诊断（describeError）也是这次的一部分：undici 的 TypeError: fetch failed 真正的原因
 * 藏在 err.cause 里（code / errno / syscall / address:port），而 desktop/log.ts 的 format()
 * 只打 err.stack，所以这次抖动**至今没法定性**。
 *
 * **本模块不许 import electron / electron-updater**：这样它才能在 node --test 里直接单测。
 * 所有外部能力都从 ProbeDeps 注入（fetch / sleep / log）。
 */

/** 最多试几次（含第一次）。10 × 300ms ≈ 3 秒，够熬过冷启动的杀软扫描，又不至于让用户干等 */
export const AUTH_PROBE_ATTEMPTS = 10
/** 两次尝试之间等多久 */
export const AUTH_PROBE_DELAY_MS = 300
/** 单次请求的超时：本机回环上的 /api/notes 正常是毫秒级，2s 已经非常宽 */
export const AUTH_PROBE_TIMEOUT_MS = 2000
/** describeError 最多展开几层 cause（再深就是噪音） */
const MAX_CAUSE_DEPTH = 5
/** 值得写进日志的诊断字段（undici / Node 网络错误就这几个） */
const DIAG_FIELDS = ['code', 'errno', 'syscall', 'hostname', 'address', 'port'] as const

/** 探针的外部依赖：全部注入，模块自己不许碰全局 fetch / 定时器 */
export interface ProbeDeps {
  fetch: typeof fetch
  sleep: (ms: number) => Promise<void>
  log: (msg: string) => void
}

/** 单行化：堆栈 / 多行 message 都不能把日志拆成好几行 */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** 读属性，永不抛（getter 里可能蹲着异常） */
function safeGet(target: unknown, key: string): unknown {
  try {
    return (target as Record<string, unknown>)[key]
  } catch {
    return undefined
  }
}

/** 安全转文本：永远不抛 */
function safeString(value: unknown): string {
  try {
    return String(value)
  } catch {
    return '[unprintable]'
  }
}

/** 普通对象 → 可读文本（JSON 优先，其次自己拼 key=value，最后退回占位） */
function plainObjectText(value: object): string {
  try {
    const json = JSON.stringify(value)
    if (typeof json === 'string') return json
  } catch {
    // 循环引用 / toJSON 抛错 / BigInt：落到下面自己拼
  }

  let keys: string[]
  try {
    keys = Object.keys(value)
  } catch {
    keys = []
  }

  const pairs: string[] = []
  for (const key of keys.slice(0, 8)) {
    const raw = safeGet(value, key)
    if (raw === undefined) continue
    pairs.push(key + '=' + (typeof raw === 'object' && raw !== null ? '[object]' : oneLine(safeString(raw))))
  }
  if (pairs.length > 0) return '{' + pairs.join(' ') + '}'
  return '[object]'
}

/** 一层的正文：Error: connect ECONNREFUSED（DOMException 之类没有 instanceof Error 的也要认） */
function layerText(value: unknown): string {
  if (typeof value === 'string') return oneLine(value)
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  if (typeof value === 'symbol') return safeString(value)
  if (typeof value === 'function') return '[function ' + safeString(safeGet(value, 'name') ?? 'anonymous') + ']'

  if (value instanceof Error) return oneLine(value.name + ': ' + value.message)

  // 跨 realm 的 Error / DOMException（AbortSignal.timeout 抛的就是 TimeoutError）：
  // instanceof Error 为 false，但 name + message 是好的
  const name = safeGet(value, 'name')
  const message = safeGet(value, 'message')
  if (typeof name === 'string' && typeof message === 'string' && message !== '') {
    return oneLine(name + ': ' + message)
  }

  return oneLine(plainObjectText(value as object))
}

/** 该层对象上真实存在的诊断字段 → [code=ECONNREFUSED syscall=connect address=127.0.0.1 port=10080] */
function diagTail(value: unknown): string {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return ''

  const parts: string[] = []
  for (const field of DIAG_FIELDS) {
    const raw = safeGet(value, field)
    if (raw === undefined || raw === null || raw === '') continue
    parts.push(field + '=' + oneLine(safeString(raw)))
  }
  return parts.length > 0 ? ' [' + parts.join(' ') + ']' : ''
}

/**
 * 把任意错误翻成一行可读文本：沿 .cause 链最多 5 层，每层 name: message，
 * 层间用 ' <- ' 连接，每层后面补它自己的诊断字段。
 *
 * 两个硬约定：**整体单行**、**永不抛**（它专门用来记录错误，自己炸了就等于把原始错误吞了）。
 * cause 自引用成环靠 Set 挡住。
 */
export function describeError(err: unknown): string {
  try {
    const seen = new Set<unknown>()
    const layers: string[] = []
    let current: unknown = err

    for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
      const container = current !== null && (typeof current === 'object' || typeof current === 'function')
      if (container) {
        if (seen.has(current)) {
          layers.push('[cause 成环，已截断]')
          break
        }
        seen.add(current)
      }

      layers.push(layerText(current) + diagTail(current))

      // 非对象没有 cause，链到此为止
      if (!container) break
      const next = safeGet(current, 'cause')
      if (next === undefined) break
      current = next
    }

    const text = oneLine(layers.join(' <- '))
    return text === '' ? '[unknown error]' : text
  } catch {
    return '[unprintable error]'
  }
}

/**
 * 撞一次「不带 cookie 的 /api/notes 必须还是 401」，失败按上面的三条约束处理。
 *
 * - 401 → log 一行 ok，resolve；
 * - 其它状态码 → 立刻 reject（鉴权被削弱，绝不重试、绝不 sleep）；
 * - fetch 抛错 → log 一行「第 n/10 次连接失败：…」，还有次数就 sleep(300) 再来，
 *   10 次用完 → reject（文本里带最后一次的诊断，别只留一句 fetch failed）。
 */
export async function probeWithRetry(url: string, deps: ProbeDeps): Promise<void> {
  let lastErr: unknown

  for (let attempt = 1; attempt <= AUTH_PROBE_ATTEMPTS; attempt++) {
    let res: Response
    try {
      res = await deps.fetch(url + '/api/notes', { signal: AbortSignal.timeout(AUTH_PROBE_TIMEOUT_MS) })
    } catch (err) {
      // 只有走到这里才叫「连接层失败」—— 服务刚 listen、系统还在扫新 exe 时就会这样
      lastErr = err
      deps.log('第 ' + attempt + '/' + AUTH_PROBE_ATTEMPTS + ' 次连接失败：' + describeError(err))
      if (attempt < AUTH_PROBE_ATTEMPTS) await deps.sleep(AUTH_PROBE_DELAY_MS)
      continue
    }

    // 拿到响应就不是网络问题了：状态码不对 = 鉴权被削弱，立刻硬失败，绝不在重试里拖
    if (res.status !== 401) {
      throw new Error('免密注入后不带 cookie 的 /api/notes 应返回 401，实际 ' + res.status)
    }

    deps.log('auth guard ok: /api/notes without cookie -> 401')
    return
  }

  throw new Error(
    '免密注入后连不上本机服务（尝试 ' + AUTH_PROBE_ATTEMPTS + ' 次，间隔 ' + AUTH_PROBE_DELAY_MS + 'ms）：' +
      describeError(lastErr),
  )
}
