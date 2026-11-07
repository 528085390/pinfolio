import { t } from '../i18n.js'

export const OUTBOUND_MODES = ['follow', 'direct', 'proxy'] as const

export const OUTBOUND_MODE_ERROR = '出站模式只能是 follow / direct / proxy'

export type PatchOk = { next: Record<string, any> }
export type PatchFail = { error: string; status: 400 | 409 }
export type PatchResult = PatchOk | PatchFail

export function asInt(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : null
}

export function policyNameRefs(beans: Record<string, any>): Map<string, number[]> {
  const out = new Map<string, number[]>()
  const walk = (v: any, hit: (name: string) => void) => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x, hit)
      return
    }
    if (!v || typeof v !== 'object') return
    const ms = (v as any).monitorStatus
    if (ms && typeof ms === 'object' && typeof ms.name === 'string') hit(ms.name)
    for (const k of Object.keys(v)) walk((v as any)[k], hit)
  }
  for (const key of Object.keys(beans)) {
    const raw = beans[key]?.policyJson ?? beans[key]?.policy_json
    if (!raw) continue
    let parsed: any = raw
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed)
      } catch {
        continue
      }
    }
    walk(parsed, (name) => {
      const list = out.get(name) || []
      list.push(Number(beans[key]?.id || key))
      out.set(name, list)
    })
  }
  return out
}

export function normalizeForKuma(next: Record<string, any>): Record<string, any> {
  next.accepted_statuscodes = Array.isArray(next.accepted_statuscodes) && next.accepted_statuscodes.length
    ? next.accepted_statuscodes.map((s: any) => String(s))
    : ['200-299']
  next.conditions = Array.isArray(next.conditions) ? next.conditions : []
  const pol = next.policyJson ?? next.policy_json
  if (pol === undefined || pol === null || pol === '') next.policyJson = null
  else if (typeof pol === 'object') next.policyJson = JSON.stringify(pol)
  else next.policyJson = String(pol)
  return next
}

export function buildMonitorPatch(
  body: Record<string, unknown>,
  bean: Record<string, any>,
  beans: Record<string, any>,
): PatchResult {
  const id = Number(bean?.id)
  const next: Record<string, any> = { ...bean }

  // ---- 名字 ----
  if (body.name !== undefined) {
    const name = String(body.name ?? '').trim()
    if (!name) return { error: t('名字不能为空'), status: 400 }
    if (name.length > 120) return { error: t('名字最长 120 字'), status: 400 }
    if (name !== String(bean.name || '').trim()) {
      const dup = Object.values(beans).find((b: any) => Number(b?.id) !== id && String(b?.name || '').trim() === name)
      if (dup) return { error: t('已经有同名观测项：{name}', { name }), status: 400 }
      const refs = policyNameRefs(beans).get(String(bean.name || '').trim())
      if (refs && refs.length) {
        return {
          error: t(
            '有策略按名字引用了「{name}」（观测项 #{refs}），改名会让策略失效。请先把那些策略改成按 id 引用或改掉名字。',
            { name: String(bean.name), refs: refs.join('、#') },
          ),
          status: 409,
        }
      }
    }
    next.name = name
  }

  // ---- 介绍 ----
  if (body.description !== undefined) {
    const desc = String(body.description ?? '').trim()
    if (desc.length > 500) return { error: t('介绍最长 500 字'), status: 400 }
    next.description = desc
  }

  // ---- 频率 / 超时 / 重试 ----
  if (body.interval !== undefined) {
    const v = asInt(body.interval)
    if (v === null || v < 20 || v > 86400) return { error: t('检查频率要在 20–86400 秒之间'), status: 400 }
    next.interval = v
  }
  if (body.timeout !== undefined) {
    const v = asInt(body.timeout)
    if (v === null || v < 1 || v > 120) return { error: t('超时要在 1–120 秒之间'), status: 400 }
    next.timeout = v
  }
  if (body.retryInterval !== undefined) {
    const v = asInt(body.retryInterval)
    if (v === null || v < 1 || v > 3600) return { error: t('重试间隔要在 1–3600 秒之间'), status: 400 }
    next.retryInterval = v
  }
  if (body.maxretries !== undefined) {
    const v = asInt(body.maxretries)
    if (v === null || v < 0 || v > 10) return { error: t('重试次数要在 0–10 之间'), status: 400 }
    next.maxretries = v
  }
  if (Number(next.timeout) >= Number(next.interval)) {
    return {
      error: t('超时（{timeout}s）必须小于检查频率（{interval}s）', { timeout: next.timeout, interval: next.interval }),
      status: 400,
    }
  }
  if (body.showMsg !== undefined) next.showMsg = body.showMsg === true || body.showMsg === 1

  // ---- 出站模式（单项钉死）----
  if ('outboundMode' in body) {
    const mode = body.outboundMode
    if (typeof mode !== 'string' || !(OUTBOUND_MODES as readonly string[]).includes(mode as any)) {
      return { error: t(OUTBOUND_MODE_ERROR), status: 400 }
    }
    next.outboundMode = mode
  }

  return { next: normalizeForKuma(next) }
}
