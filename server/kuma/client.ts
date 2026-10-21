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
// 脱敏与展示映射在 redact.ts（纯函数，可单测）；这里只做再导出，老的 './client.js' 调用点不用改。
export type { MonitorView, PolicyInfo } from './redact.js'
export { describeTarget, redactUrl, summarizePolicy, toView } from './redact.js'
