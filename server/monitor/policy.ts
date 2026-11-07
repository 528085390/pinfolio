/**
 * Pure function observation policy engine.
 *
 * Evaluates gate conditions and dynamic probe intervals for monitors.
 * Ported from Kuma server/model/policy.js into TypeScript.
 */

export const STATUS = {
  DOWN: 0,
  UP: 1,
  PENDING: 2,
  MAINTENANCE: 3,
} as const

export const STATUS_NAMES: Record<number, string> = {
  [STATUS.DOWN]: 'DOWN',
  [STATUS.UP]: 'UP',
  [STATUS.PENDING]: 'PENDING',
  [STATUS.MAINTENANCE]: 'MAINTENANCE',
}

const VALID_STATUS = new Set(['UP', 'DOWN', 'PENDING', 'MAINTENANCE'])
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const UNIMPLEMENTED_ATOMS = new Set(['signal'])

export const POLICY_PRESETS: Record<string, any> = {
  'fixed-60': { v: 1, interval: { default: 60 } },
  'fixed-600': { v: 1, interval: { default: 600 } },
  'adaptive-20-10': {
    v: 1,
    interval: {
      default: 1200,
      rules: [{ when: { selfStatus: ['DOWN', 'PENDING'] }, interval: 600 }],
    },
  },
  'adaptive-5-1': {
    v: 1,
    interval: {
      default: 300,
      rules: [{ when: { selfStatus: ['DOWN', 'PENDING'] }, interval: 60 }],
    },
  },
  'business-hours': {
    v: 1,
    interval: {
      default: 1200,
      rules: [{ when: { time: { from: '08:00', to: '23:00' } }, interval: 60 }],
    },
  },
  'llm-on-api-up': {
    v: 1,
    gate: { when: { monitorStatus: { id: 3, is: 'UP' } }, recheck: 300 },
    interval: { default: 600 },
  },
}

export interface PolicyContext {
  now?: Date
  selfStatus?: number | string
  selfDownCount?: number
  selfPingMs?: number | null
  monitorsStatus?: Record<string | number, number | string>
  deps?: Map<number, string>
  nameToId?: Map<string, number>
  depLabels?: Map<number, string>
}

export interface PolicyEvaluation {
  gate: boolean
  interval: number
  status?: number
  reason?: string
}

export interface ParsedPolicy {
  v: number
  gate?: {
    when?: any
    onSkip?: string
    recheck?: number
  }
  interval?: {
    default?: number
    rules?: Array<{
      when?: any
      interval: number
    }>
  }
  [key: string]: any
}

function clamp(n: any, min: number, max: number): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return min
  return Math.min(max, Math.max(min, v))
}

export function statusName(status: number | string | null | undefined): string | null {
  if (status === null || status === undefined) return null
  if (typeof status === 'string') {
    const upper = status.toUpperCase()
    return VALID_STATUS.has(upper) ? upper : null
  }
  return STATUS_NAMES[status] ?? null
}

export function normalizeStatusSel(sel: any): string[] | null {
  const list = Array.isArray(sel) ? sel : [sel]
  if (list.length === 0) return null
  const out: string[] = []
  for (const item of list) {
    if (typeof item !== 'string') return null
    const name = item.toUpperCase()
    if (!VALID_STATUS.has(name)) return null
    out.push(name)
  }
  return out
}

function isNonNegativeInt(v: any): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

function parseHhMm(value: any): number | null {
  if (typeof value !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (hh > 23 || mm > 59) return null
  return hh * 60 + mm
}

function normalizeDays(days: any): Set<number> | null {
  if (days === undefined || days === null) return null
  const list = Array.isArray(days) ? days : [days]
  const out = new Set<number>()
  for (const item of list) {
    if (typeof item === 'number' && Number.isInteger(item) && item >= 1 && item <= 7) {
      out.add(item)
    } else if (typeof item === 'string') {
      const idx = WEEKDAYS.indexOf(item.trim().toLowerCase())
      if (idx === -1) return null
      out.add(idx + 1)
    } else {
      return null
    }
  }
  return out
}

function isoWeekday(date: Date): number {
  const jsDay = date.getDay()
  return ((jsDay + 6) % 7) + 1
}

export function parsePolicy(input: any): { policy: ParsedPolicy | null; error: Error | null } {
  if (input === null || input === undefined) {
    return { policy: null, error: null }
  }

  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (trimmed === '') {
      return { policy: null, error: null }
    }
    // Check if it's a known preset name
    if (POLICY_PRESETS[trimmed]) {
      return { policy: POLICY_PRESETS[trimmed], error: null }
    }
    try {
      input = JSON.parse(trimmed)
    } catch (e: any) {
      return { policy: null, error: e }
    }
  }

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { policy: null, error: new Error('policy must be a JSON object') }
  }

  const v = input.v === undefined || input.v === null ? 1 : input.v
  if (v !== 1) {
    return { policy: null, error: new Error('unsupported policy version: ' + v) }
  }

  return { policy: { ...input, v: 1 }, error: null }
}

function resolveDepId(value: any, ctx: InternalContext): number | null {
  if (typeof value.id === 'number') return value.id
  if (typeof value.id === 'string') {
    const parsed = parseInt(value.id, 10)
    if (!isNaN(parsed)) return parsed
  }
  if (typeof value.name === 'string' && ctx.nameToId.has(value.name)) {
    return ctx.nameToId.get(value.name) ?? null
  }
  return null
}

interface InternalContext {
  now: Date
  selfStatus: string | null
  selfDownCount: number
  selfPingMs: number | null
  deps: Map<number, string>
  nameToId: Map<string, number>
  depLabels: Map<number, string>
}

function buildInternalContext(ctx?: PolicyContext): InternalContext {
  const now = ctx?.now instanceof Date ? ctx.now : new Date()
  const selfStatus = statusName(ctx?.selfStatus)
  const selfDownCount = typeof ctx?.selfDownCount === 'number' ? ctx.selfDownCount : 0
  const selfPingMs =
    typeof ctx?.selfPingMs === 'number' && Number.isFinite(ctx.selfPingMs) ? ctx.selfPingMs : null

  const deps = new Map<number, string>(ctx?.deps || [])
  const nameToId = new Map<string, number>(ctx?.nameToId || [])
  const depLabels = new Map<number, string>(ctx?.depLabels || [])

  if (ctx?.monitorsStatus) {
    for (const [k, v] of Object.entries(ctx.monitorsStatus)) {
      const s = statusName(v)
      if (s) {
        const numId = Number(k)
        if (!isNaN(numId)) {
          deps.set(numId, s)
        } else {
          // It's a name
          const mappedId = nameToId.get(k)
          if (mappedId !== undefined) {
            deps.set(mappedId, s)
          }
        }
      }
    }
  }

  return {
    now,
    selfStatus,
    selfDownCount,
    selfPingMs,
    deps,
    nameToId,
    depLabels,
  }
}

function evalAtom(key: string, value: any, ctx: InternalContext): boolean {
  switch (key) {
    case 'all': {
      if (!Array.isArray(value)) return false
      return value.every((c) => evalNode(c, ctx))
    }
    case 'any': {
      if (!Array.isArray(value)) return false
      return value.some((c) => evalNode(c, ctx))
    }
    case 'not': {
      if (value === undefined) return false
      return !evalNode(value, ctx)
    }
    case 'selfStatus': {
      const sel = normalizeStatusSel(value)
      if (sel === null || !ctx.selfStatus) return false
      return sel.includes(ctx.selfStatus)
    }
    case 'monitorStatus': {
      if (!value || typeof value !== 'object') return false
      const sel = normalizeStatusSel(value.is)
      if (sel === null) return false
      const id = resolveDepId(value, ctx)
      if (id === null || !ctx.deps.has(id)) return false
      return sel.includes(ctx.deps.get(id)!)
    }
    case 'selfDownCount': {
      const gte = value && value.gte
      if (!isNonNegativeInt(gte)) return false
      return ctx.selfDownCount >= gte
    }
    case 'selfPingMs': {
      const gte = value && value.gte
      if (!isNonNegativeInt(gte) || ctx.selfPingMs === null) return false
      return ctx.selfPingMs >= gte
    }
    case 'time': {
      if (!value || typeof value !== 'object') return false
      const from = parseHhMm(value.from)
      const to = parseHhMm(value.to)
      if (from === null || to === null) return false
      const days = normalizeDays(value.days)
      if (value.days !== undefined && value.days !== null && days === null) return false

      if (days !== null && !days.has(isoWeekday(ctx.now))) return false

      const minutes = ctx.now.getHours() * 60 + ctx.now.getMinutes()
      if (from <= to) {
        return minutes >= from && minutes < to
      }
      return minutes >= from || minutes < to
    }
    default:
      return false
  }
}

function evalNode(cond: any, ctx: InternalContext): boolean {
  if (cond === undefined || cond === null || cond === true) return true
  if (cond === false) return false
  if (typeof cond !== 'object' || Array.isArray(cond)) return false

  const keys = Object.keys(cond)
  if (keys.length === 0) return true

  for (const key of keys) {
    if (!evalAtom(key, cond[key], ctx)) {
      return false
    }
  }
  return true
}

function explainNode(cond: any, ctx: InternalContext): string {
  if (cond === undefined || cond === null || cond === true) return '总是'
  if (cond === false) return '从不'
  if (typeof cond !== 'object' || Array.isArray(cond)) return '非法条件'

  const parts: string[] = []
  for (const key of Object.keys(cond)) {
    const value = cond[key]
    switch (key) {
      case 'all':
        parts.push(Array.isArray(value) ? value.map((c) => explainNode(c, ctx)).join(' 且 ') : 'all 非法')
        break
      case 'any':
        parts.push(Array.isArray(value) ? value.map((c) => explainNode(c, ctx)).join(' 或 ') : 'any 非法')
        break
      case 'not':
        parts.push('非(' + explainNode(value, ctx) + ')')
        break
      case 'selfStatus': {
        const sel = normalizeStatusSel(value)
        parts.push('自身状态 ' + (sel === null ? '非法' : '= ' + sel.join('/')))
        break
      }
      case 'monitorStatus': {
        const id = resolveDepId(value || {}, ctx)
        const label =
          id !== null && ctx.depLabels.has(id) ? ctx.depLabels.get(id) : '#' + (id === null ? '?' : id)
        const sel = normalizeStatusSel(value && value.is)
        const actual = id !== null ? ctx.deps.get(id) : undefined
        let line = '依赖 ' + label + ' = ' + (sel === null ? '非法' : sel.join('/'))
        if (actual !== undefined && actual !== null) {
          line += '（当前 ' + actual + (actual === 'MAINTENANCE' ? '，已跳过' : '') + '）'
        }
        parts.push(line)
        break
      }
      case 'selfDownCount':
        parts.push('连续失败 ≥ ' + (value && value.gte) + ' 次')
        break
      case 'selfPingMs':
        parts.push('延迟 ≥ ' + (value && value.gte) + 'ms')
        break
      case 'time': {
        const days =
          value && value.days ? ' ' + (Array.isArray(value.days) ? value.days.join('/') : value.days) : ''
        parts.push('时间窗 ' + (value && value.from) + '-' + (value && value.to) + days + ' 之外')
        break
      }
      default:
        parts.push(UNIMPLEMENTED_ATOMS.has(key) ? key + ' 未实现' : '未知条件 ' + key)
        break
    }
  }
  return parts.join(' 且 ')
}

export function explainPolicy(cond: any, ctx?: PolicyContext): string {
  try {
    const internalCtx = buildInternalContext(ctx)
    const s = explainNode(cond, internalCtx)
    return s === '' ? '条件不成立' : s
  } catch {
    return '条件不成立'
  }
}

function resolveInterval(spec: any, ctx: InternalContext, baseInterval: number): number {
  if (!spec || typeof spec !== 'object') return baseInterval
  const rules = Array.isArray(spec.rules) ? spec.rules : []
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue
    if (evalNode(rule.when, ctx)) {
      return clamp(rule.interval, 1, 86400)
    }
  }
  const fallback = spec.default === undefined || spec.default === null ? baseInterval : spec.default
  return clamp(fallback, 1, 86400)
}

/**
 * Pure evaluation function for observation policies.
 */
export function evaluatePolicy(
  policyJson: string | null | undefined,
  baseInterval: number,
  ctx?: PolicyContext
): PolicyEvaluation {
  const { policy, error } = parsePolicy(policyJson)
  if (error || !policy) {
    return { gate: true, interval: baseInterval }
  }

  const internalCtx = buildInternalContext(ctx)

  // Gate evaluation
  if (policy.gate && policy.gate.when !== undefined) {
    const gatePassed = evalNode(policy.gate.when, internalCtx)
    if (!gatePassed) {
      const recheckInterval =
        typeof policy.gate.recheck === 'number' && policy.gate.recheck >= 1
          ? policy.gate.recheck
          : resolveInterval(policy.interval, internalCtx, baseInterval)
      return {
        gate: false,
        status: STATUS.MAINTENANCE,
        interval: recheckInterval,
        reason: explainNode(policy.gate.when, internalCtx),
      }
    }
  }

  // Interval evaluation
  const interval = resolveInterval(policy.interval, internalCtx, baseInterval)
  return {
    gate: true,
    interval,
  }
}
