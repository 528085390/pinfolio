import { t } from '../i18n.js'

export type ActionStep = {
  type: string
  label: string
  hint?: string
  [key: string]: any
}

export type ActionRecipe = {
  source: 'config' | 'default' | 'none'
  steps: ActionStep[]
  disabledReason: string | null
}

export type Rule = { id?: number; name?: string; steps?: any[]; disabledReason?: string }

export const STEP_LABEL: Record<string, string> = {
  'kuma-check': '让 Kuma 立刻探测一次',
  http: '发一个 HTTP 请求',
  command: '跑一条命令',
}

export const DEFAULT_TIMEOUT_S: Record<string, number> = { 'kuma-check': 25, http: 15, command: 30 }

export function parseRules(parsed: unknown): Rule[] {
  const anyParsed = parsed as any
  const list = Array.isArray(anyParsed) ? anyParsed : Array.isArray(anyParsed?.recipes) ? anyParsed.recipes : []
  return list.filter((r: any) => r && typeof r === 'object')
}

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
    steps: [{ type: 'kuma-check', label: t(STEP_LABEL['kuma-check']), hint: t('重启检查循环，探针会马上跑一次真实探测') }],
    disabledReason: null,
  }
}

export function timeoutOf(step: ActionStep, budgetMs: number): number {
  const fallback = DEFAULT_TIMEOUT_S[step.type] ?? 15
  const want = Number(step.timeout)
  const sec = Number.isFinite(want) && want > 0 ? want : fallback
  return Math.max(1000, Math.min(sec * 1000, budgetMs))
}

export function clip(s: unknown, max = 300): string {
  const x = String(s ?? '').replace(/\s+/g, ' ').trim()
  return x.length > max ? x.slice(0, max) + '…' : x
}

export function statusText(s: number): string {
  return s === 1 ? t('正常') : s === 0 ? t('故障') : s === 2 ? t('待定') : s === 3 ? t('维护') : t('未知')
}
