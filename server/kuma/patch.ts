import { t } from '../i18n.js'

/**
 * PATCH /api/monitors/:id 的校验与归一化 —— 纯函数，不碰网络、不碰数据库，所以能单测。
 *
 * 为什么值得单独一块：Kuma 的 `editMonitor` 是**全量覆盖**，前端漏传一个字段就会把库里那份清掉；
 * 而这里每一条边界（名字 1–120、频率 20–86400、超时 1–120 且小于频率、重试 1–3600 / 0–10、
 * accepted_statuscodes 归一成字符串数组、policyJson 只认字符串或对象）都是踩过才写下的。
 */

/** 单项出站模式的三个合法值（与 kuma 的 `outbound_mode` 列、抽屉表单逐字对齐，别加别名）。 */
export const OUTBOUND_MODES = ['follow', 'direct', 'proxy'] as const

/** 值域拒绝时的文案（点名三个合法值：用户得知道该填什么） */
export const OUTBOUND_MODE_ERROR = '出站模式只能是 follow / direct / proxy'

export type PatchOk = { next: Record<string, any> }
export type PatchFail = { error: string; status: 400 | 409 }
export type PatchResult = PatchOk | PatchFail

/** 宽松取整：空值 / 非数字回 null，其余四舍五入 */
export function asInt(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : null
}

/** 收集所有策略里「按名字」引用观测项的地方（policy_json 的 monitorStatus.name）。 */
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

/**
 * editMonitor 会把这些原样 JSON.stringify 写库，所以先归一化：
 * - accepted_statuscodes 必须是**字符串**数组（数字会让 Kuma 的匹配失效），空值回 `['200-299']`
 * - conditions 必须是数组
 * - policyJson 只认字符串或对象（对象转字符串），空值一律 null
 *
 * 其它字段（含 outboundMode）**原样透传**：值域校验只在上面的 buildMonitorPatch 一处做，
 * 这里再校验一次就会出现两套文案、两套边界。
 */
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

/**
 * 把 PATCH 请求体合并到现有 bean 上，逐项校验。
 *
 * - `bean` 是 `getMonitor(id)` 拿到的原始 bean（不是脱敏后的 view）
 * - `beans` 是 `listMonitors()` 的全量（判重名、扫策略引用用）
 * - 返回的 `next` **可能没有 showMsg**：Kuma 的 toJSON 不返回它，要调用方从状态页补
 *   （不补的话 `Boolean(undefined)` 会把 show_msg 静默改成 false）
 */
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
  // 这一条对「只改名」的请求也生效：用的是合并后的值
  if (Number(next.timeout) >= Number(next.interval)) {
    return {
      error: t('超时（{timeout}s）必须小于检查频率（{interval}s）', { timeout: next.timeout, interval: next.interval }),
      status: 400,
    }
  }
  if (body.showMsg !== undefined) next.showMsg = body.showMsg === true || body.showMsg === 1

  // ---- 出站模式（单项钉死）----
  // 用 "in body" 而不是 !== undefined：显式传 undefined / null 也算「给了个非法值」要拒，
  // 而请求体里压根没有这个键（改名、改频率这些老调用方）时一个字段都不碰 ——
  // next 是从 bean 拷的，bean 里本来就带着当前的 outboundMode，原样写回不会把它冲掉。
  if ('outboundMode' in body) {
    const mode = body.outboundMode
    if (typeof mode !== 'string' || !(OUTBOUND_MODES as readonly string[]).includes(mode)) {
      return { error: t(OUTBOUND_MODE_ERROR), status: 400 }
    }
    next.outboundMode = mode
  }

  return { next: normalizeForKuma(next) }
}
