import { io, type Socket } from 'socket.io-client'

// 观测项的「可写」通道：Kuma 的公开状态页接口只能读，改名 / 暂停 / 删除 / 立即探测
// 都得走它自己的 socket.io API（前端被删了，但服务端事件还在）。
//
//   KUMA_URL   Kuma 地址，默认 http://127.0.0.1:3001
//   KUMA_USER  / KUMA_PASS  Kuma 登录凭据（与 kuma/tools/kuma-monitor.cjs 一致）
//
// 一条铁律：**所有出口都过白名单**。getMonitor 回来的 bean 带 sshPrivateKey、
// basic_auth_pass 之类的明文凭据，直接把 bean 丢给浏览器等于把服务器密码贴到网页上。
export const KUMA_URL = (process.env.KUMA_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '')
const KUMA_USER = process.env.KUMA_USER || 'admin'
const KUMA_PASS = process.env.KUMA_PASS || ''

const CALL_TIMEOUT = 20000

export class KumaError extends Error {
  code: string
  constructor(message: string, code = 'kuma') {
    super(message)
    this.name = 'KumaError'
    this.code = code
  }
}

let socket: Socket | null = null
let connecting: Promise<Socket> | null = null

function openSocket(): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    // 不要传 transports: ['websocket']：Kuma 的 socket.io 服务端只挂了 polling 握手，
    // 强制 websocket 会一直连不上（实测握手超时）。
    const s = io(KUMA_URL, { timeout: 10000, reconnection: false })
    let settled = false
    const fail = (msg: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { s.close() } catch { /* ignore */ }
      if (socket === s) socket = null
      reject(new KumaError('连不上 Kuma（' + KUMA_URL + '）：' + msg, 'offline'))
    }
    const timer = setTimeout(() => fail('登录超时'), 12000)
    s.on('connect_error', (e: any) => fail(String(e?.message || e)))
    s.on('connect', () => {
      s.emit('login', { username: KUMA_USER, password: KUMA_PASS }, (res: any) => {
        if (settled) return
        if (!res || !res.ok) return fail(res?.msg ? String(res.msg) : '登录被拒（检查 KUMA_USER / KUMA_PASS）')
        settled = true
        clearTimeout(timer)
        socket = s
        s.on('disconnect', () => { if (socket === s) socket = null })
        resolve(s)
      })
    })
  })
}

/** 懒连接：一个进程一条 socket，断了下次调用自动重连。 */
export function connect(): Promise<Socket> {
  if (socket?.connected) return Promise.resolve(socket)
  if (!connecting) {
    connecting = openSocket().finally(() => { connecting = null })
  }
  return connecting
}

/** 调一个 Kuma 事件并等 ack。ack 里 ok === false 一律当失败抛出。 */
export function call<T = any>(event: string, ...args: any[]): Promise<T> {
  return connect().then((s) => new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new KumaError('Kuma 无响应：' + event, 'timeout')), CALL_TIMEOUT)
    s.emit(event, ...args, (res: any) => {
      clearTimeout(timer)
      if (res && res.ok === false) return reject(new KumaError(String(res.msg || ('Kuma 拒绝了 ' + event)), 'rejected'))
      resolve(res as T)
    })
  }))
}

/** 观测项列表：getMonitorList 的 ack 只回 {ok:true}，真正的数据是随后推来的 monitorList 事件。 */
export async function listMonitors(): Promise<Record<string, any>> {
  const s = await connect()
  return new Promise<Record<string, any>>((resolve, reject) => {
    const onList = (list: any) => {
      clearTimeout(timer)
      s.off('monitorList', onList)
      resolve(list && typeof list === 'object' ? list : {})
    }
    const timer = setTimeout(() => {
      s.off('monitorList', onList)
      reject(new KumaError('拿观测项列表超时', 'timeout'))
    }, CALL_TIMEOUT)
    s.on('monitorList', onList)
    s.emit('getMonitorList', () => { /* ack 里没数据 */ })
  })
}

export async function getMonitor(id: number): Promise<any> {
  const res = await call<any>('getMonitor', id)
  if (!res?.monitor) throw new KumaError('Kuma 没有观测项 #' + id, 'notfound')
  return res.monitor
}

export async function getBeats(id: number, hours = 24): Promise<any[]> {
  const res = await call<any>('getMonitorBeats', id, hours)
  return Array.isArray(res?.data) ? res.data : []
}

export async function editMonitor(bean: any): Promise<void> {
  await call('editMonitor', bean)
}

export async function pauseMonitor(id: number): Promise<void> {
  await call('pauseMonitor', id)
}

export async function resumeMonitor(id: number): Promise<void> {
  await call('resumeMonitor', id)
}

export async function deleteMonitor(id: number): Promise<void> {
  await call('deleteMonitor', id, false)
}

/**
 * 让 Kuma 立刻跑一次真实探测。
 * Kuma 的 socket 上**没有** restartMonitor 事件（server.js 里 restartMonitor 只是内部函数），
 * 但 resumeMonitor 就是「startMonitor」：它把 active 置 1、stop() 掉旧的检查循环再 start()，
 * 而 monitor.start() 对非 push 型是**立即** safeBeat()（kuma/server/model/monitor.js:1292），
 * 所以调用返回后几百毫秒内就会多一条新心跳。
 * 注意它同时会把 active 置回 1 —— 调用方必须先确认观测项没被暂停。
 */
export async function kickCheck(id: number): Promise<void> {
  await resumeMonitor(id)
}

/* ---------------- 出口白名单 / 脱敏 ---------------- */

export type PolicyInfo = { name: string; summary: string }

export type MonitorView = {
  id: number
  name: string
  type: string
  description: string
  showMsg: boolean
  interval: number
  timeout: number
  maxretries: number
  retryInterval: number
  active: boolean
  /** 观测目标的一句话描述（URL / host:port / 推送型…），敏感部分已打码 */
  target: string
  policy: PolicyInfo | null
}

const SECRET_PARAM = /(key|token|pass|pwd|secret|auth|sign|sig|credential|cookie)/i

/** URL 里的账号密码与敏感 query 参数一律打码。 */
export function redactUrl(raw: string): string {
  const s = String(raw || '')
  if (!s) return ''
  try {
    const u = new URL(s)
    if (u.username || u.password) {
      u.username = '***'
      u.password = ''
    }
    for (const k of [...u.searchParams.keys()]) {
      if (SECRET_PARAM.test(k)) u.searchParams.set(k, '***')
    }
    return u.toString()
  } catch {
    return s.replace(/((?:password|passwd|token|secret|api[_-]?key|authorization)\s*[=:]\s*)([^\s&'"]+)/gi, '$1***')
  }
}

/** 命令里 --password=xxx 这种也顺手打码，再截断。 */
function redactCommand(raw: string, max = 120): string {
  const s = String(raw || '').replace(/((?:password|passwd|token|secret|api[_-]?key|authorization)\s*[=:]\s*)([^\s&'"]+)/gi, '$1***')
  return s.length > max ? s.slice(0, max) + '…' : s
}

export function describeTarget(bean: any): string {
  const type = String(bean?.type || '')
  const host = String(bean?.hostname || '').trim()
  const port = bean?.port ? String(bean.port) : ''
  if (type === 'push') return '推送型（由外部心跳驱动）'
  if (type === 'http' || type === 'keyword' || type === 'json-query' || type === 'grpc' || type === 'real-browser') {
    return redactUrl(String(bean?.url || '')) || '—'
  }
  if (type === 'port' || type === 'ping') return host ? (port ? host + ':' + port : host) : '—'
  if (type === 'dns') return String(bean?.dns_resolve_server || bean?.hostname || '—')
  if (type === 'ssh') {
    const user = String(bean?.sshUsername || '').trim()
    const head = (user ? user + '@' : '') + host + (port ? ':' + port : '')
    const cmd = redactCommand(String(bean?.sshCommand || ''), 90)
    return cmd ? head + '  ' + cmd : head
  }
  if (type === 'docker') return String(bean?.docker_container || '') || '—'
  if (type === 'mqtt') return redactUrl(String(bean?.mqttServer || '')) || '—'
  return host || redactUrl(String(bean?.url || '')) || '—'
}

function fmtSec(n: unknown): string {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return '—'
  if (v < 60) return v + ' 秒'
  if (v % 3600 === 0) return v / 3600 + ' 小时'
  if (v % 60 === 0) return v / 60 + ' 分钟'
  return v + ' 秒'
}

function describeWhen(when: any, names?: Record<string, string>): string {
  if (!when || typeof when !== 'object') return '条件'
  const bits: string[] = []
  if (when.time && typeof when.time === 'object') {
    bits.push('时间 ' + String(when.time.from || '00:00') + '–' + String(when.time.to || '24:00'))
  }
  if (when.monitorStatus && typeof when.monitorStatus === 'object') {
    const ref = when.monitorStatus.name
      ? '「' + String(when.monitorStatus.name) + '」'
      : when.monitorStatus.id !== undefined
        ? '#' + String(when.monitorStatus.id) + (names?.[String(when.monitorStatus.id)] ? '「' + names[String(when.monitorStatus.id)] + '」' : '')
        : '关联观测项'
    bits.push(ref + ' 为 ' + String(when.monitorStatus.is || 'UP'))
  }
  if (when.status && typeof when.status === 'object') {
    bits.push('状态为 ' + String(when.status.is || when.status.in || '?'))
  }
  if (when.weekday) bits.push('星期 ' + String(Array.isArray(when.weekday) ? when.weekday.join(',') : when.weekday))
  return bits.length ? bits.join(' 且 ') : JSON.stringify(when).slice(0, 80)
}

/** 把 policy_json 说成人话（只读展示用，不参与求值）。 */
export function summarizePolicy(raw: unknown, names?: Record<string, string>): PolicyInfo | null {
  if (raw === null || raw === undefined || raw === '') return null
  let p: any = raw
  if (typeof p === 'string') {
    const text = p.trim()
    if (!text) return null
    try { p = JSON.parse(text) } catch { return { name: '自定义', summary: text.slice(0, 200) } }
  }
  if (!p || typeof p !== 'object') return null

  const parts: string[] = []
  const gate = p.gate && typeof p.gate === 'object' ? p.gate : null
  const interval = p.interval && typeof p.interval === 'object' ? p.interval : null
  if (gate?.when) {
    parts.push('门控：' + describeWhen(gate.when, names) + ' 才检查' + (gate.recheck ? '（否则每 ' + fmtSec(gate.recheck) + '复查一次）' : ''))
  }
  const rules: any[] = interval && Array.isArray(interval.rules) ? interval.rules : []
  if (interval) {
    if (!rules.length) {
      parts.push('频率：固定每 ' + fmtSec(interval.default))
    } else {
      parts.push('频率：默认每 ' + fmtSec(interval.default))
      for (const r of rules.slice(0, 4)) {
        parts.push(describeWhen(r?.when, names) + ' → 每 ' + fmtSec(r?.interval))
      }
      if (rules.length > 4) parts.push('另有 ' + (rules.length - 4) + ' 条规则')
    }
  }
  const name = gate && rules.length ? '门控 + 条件频率' : gate ? '门控' : rules.length ? '条件频率' : '自定义策略'
  return { name, summary: parts.join('；') || JSON.stringify(p).slice(0, 200) }
}

/** bean → 前端能看的那点东西。**只列白名单字段**，多一个都不给。 */
export function toView(bean: any, names?: Record<string, string>): MonitorView {
  return {
    id: Number(bean?.id || 0),
    name: String(bean?.name || ''),
    type: String(bean?.type || 'http'),
    description: String(bean?.description || ''),
    showMsg: bean?.showMsg === true || bean?.showMsg === 1,
    interval: Number(bean?.interval || 60),
    timeout: Number(bean?.timeout || 0),
    maxretries: Number(bean?.maxretries || 0),
    retryInterval: Number(bean?.retryInterval || 60),
    active: bean?.active === true || bean?.active === 1,
    target: describeTarget(bean),
    policy: summarizePolicy(bean?.policyJson ?? bean?.policy_json, names),
  }
}
