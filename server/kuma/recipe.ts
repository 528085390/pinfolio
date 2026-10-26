import { t } from '../i18n.js'

/**
 * 「立即观测」配方的**纯逻辑**：解析 monitor-actions.json 的内容、挑配方、判置灰原因、算每步超时。
 * 这里不碰网络、不 spawn 进程，所以能单测；执行在 runner.ts。
 *
 *   {
 *     "recipes": [
 *       { "id": 27, "steps": [{ "type": "kuma-check" }] },
 *       { "name": "每日打卡 / 每日续火花", "steps": [{ "type": "command", "argv": ["node", "x.cjs"] }] }
 *     ]
 *   }
 */

export type ActionStep = {
  type: string
  label: string
  /** 步骤的一句话说明，抽屉里当副标题显示 */
  hint?: string
  [key: string]: any
}

export type ActionRecipe = {
  source: 'config' | 'default' | 'none'
  steps: ActionStep[]
  /** 非 null 时按钮置灰，这里是原因 */
  disabledReason: string | null
}

export type Rule = { id?: number; name?: string; steps?: any[]; disabledReason?: string }

export const STEP_LABEL: Record<string, string> = {
  'kuma-check': '让 Kuma 立刻探测一次',
  http: '发一个 HTTP 请求',
  command: '跑一条命令',
}

/** 每步的默认超时（秒），配方里可以用 timeout 覆盖。 */
export const DEFAULT_TIMEOUT_S: Record<string, number> = { 'kuma-check': 25, http: 15, command: 30 }

/**
 * 把 monitor-actions.json 的内容解析成配方列表。
 * 顶层数组和 `{ recipes: [...] }` 两种写法都认；写坏了当没配方，不影响观测页。
 */
export function parseRules(parsed: unknown): Rule[] {
  const anyParsed = parsed as any
  const list = Array.isArray(anyParsed) ? anyParsed : Array.isArray(anyParsed?.recipes) ? anyParsed.recipes : []
  return list.filter((r: any) => r && typeof r === 'object')
}

/** 归一化步骤：补默认 label、只留字符串 hint、丢掉没有字符串 type 的项。 */
export function normalizeSteps(steps: any[] | undefined): ActionStep[] {
  if (!Array.isArray(steps)) return []
  return steps
    .filter((s) => s && typeof s === 'object' && typeof s.type === 'string')
    .map((s) => ({
      ...s,
      type: String(s.type),
      label: typeof s.label === 'string' && s.label
        ? s.label
        : (STEP_LABEL[s.type] ? t(STEP_LABEL[s.type]) : t('步骤：{type}', { type: String(s.type) })),
      hint: typeof s.hint === 'string' ? s.hint : undefined,
    }))
}

/**
 * 从配方列表里挑出这个观测项该用的配方。
 * **先按 id 再按名字**（改名不会悄悄换掉动作）。
 */
export function resolveFromRules(rules: Rule[], m: { id: number; name: string; type: string }): ActionRecipe {
  const hit = rules.find((r) => typeof r.id === 'number' && r.id === m.id)
    || rules.find((r) => typeof r.name === 'string' && r.name === m.name)

  if (hit) {
    const steps = normalizeSteps(hit.steps)
    const unknown = steps.find((s) => !STEP_LABEL[s.type])
    const reason = hit.disabledReason
      || (unknown ? t('配方里有不认识的步骤类型：{type}', { type: String(unknown.type) }) : null)
      || (steps.length === 0 ? t('配方里没有步骤') : null)
    return { source: 'config', steps, disabledReason: reason }
  }

  // 推送型没有「探一次」这回事，只能配配方
  if (m.type === 'push') {
    return {
      source: 'none',
      steps: [],
      disabledReason: t('推送型观测项由外部心跳驱动，Kuma 没有「立刻探一次」这回事；要在抽屉里点按钮，请给它在 monitor-actions.json 里配一条配方。'),
    }
  }

  return {
    source: 'default',
    steps: [{ type: 'kuma-check', label: t(STEP_LABEL['kuma-check']), hint: t('重启检查循环，Kuma 会马上跑一次真实探测') }],
    disabledReason: null,
  }
}

/** 这一步能花多久：配方里的 timeout 优先，否则按类型取默认；夹在 1 秒与剩余预算之间。 */
export function timeoutOf(step: ActionStep, budgetMs: number): number {
  const fallback = DEFAULT_TIMEOUT_S[step.type] ?? 15
  const want = Number(step.timeout)
  const sec = Number.isFinite(want) && want > 0 ? want : fallback
  return Math.max(1000, Math.min(sec * 1000, budgetMs))
}

/** 压成一行并截断（抽屉里一行一条，不能换行）。 */
export function clip(s: unknown, max = 300): string {
  const x = String(s ?? '').replace(/\s+/g, ' ').trim()
  return x.length > max ? x.slice(0, max) + '…' : x
}

/** Kuma 的状态码说人话（0 DOWN / 1 UP / 2 PENDING / 3 MAINTENANCE）。 */
export function statusText(s: number): string {
  return s === 1 ? t('正常') : s === 0 ? t('故障') : s === 2 ? t('待定') : s === 3 ? t('维护') : t('未知')
}
