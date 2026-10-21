/**
 * Kuma monitor（bean）→ 前端能看的那点东西：脱敏、目标描述、策略说人话。
 * 全是纯函数，单独放一个文件是为了能单测 —— client.ts 里有 socket.io 连接。
 */

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
