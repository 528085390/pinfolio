import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { t } from '../i18n.js'
import { clip, statusText, timeoutOf, type ActionRecipe, type ActionStep } from './recipe.js'
import type { ProbeResult } from './types.js'

export type StepResult = {
  type: string
  label: string
  ok: boolean
  detail: string
  ms: number
}

const TOTAL_BUDGET_MS = 60_000

async function runProbeCheck(
  id: number,
  _step: ActionStep,
  _budgetMs: number,
  engine?: { probeNow: (id: number) => Promise<ProbeResult> }
): Promise<{ ok: boolean; detail: string }> {
  if (!engine) {
    return { ok: false, detail: t('探针引擎未初始化') }
  }
  const result = await engine.probeNow(id)
  return {
    ok: true,
    detail: statusText(Number(result.status)) + ' · ' + clip(result.msg || t('（无消息）'), 200),
  }
}

async function runHttp(step: ActionStep, budgetMs: number): Promise<{ ok: boolean; detail: string }> {
  const url = String(step.url || '')
  if (!url) return { ok: false, detail: t('配方里没写 url') }
  const method = String(step.method || 'GET').toUpperCase()
  const headers: Record<string, string> = { ...(step.headers && typeof step.headers === 'object' ? step.headers : {}) }
  let body: string | undefined
  if (step.body !== undefined && step.body !== null) {
    body = typeof step.body === 'string' ? step.body : JSON.stringify(step.body)
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json'
  }

  const res = await fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(timeoutOf(step, budgetMs)),
  })
  const text = await res.text().catch(() => '')
  let message = ''
  try {
    const j = JSON.parse(text)
    if (typeof j?.message === 'string') message = j.message
    else if (typeof j?.msg === 'string') message = j.msg
    else if (typeof j?.error === 'string') message = j.error
  } catch {
    // 不是 JSON 就退回原文
  }
  const detail = 'HTTP ' + res.status + (message ? ' · ' + clip(message, 200) : text ? ' · ' + clip(text, 200) : '')
  return { ok: res.ok, detail }
}

function spawnCommand(argv: string[], cwd: string, timeoutMs: number): Promise<{ code: number | null; out: string; err: string; timedOut: boolean; spawnError?: string }> {
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let timedOut = false
    let done = false
    const finish = (code: number | null, spawnError?: string) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ code, out, err, timedOut, spawnError })
    }
    let child
    try {
      child = spawn(argv[0], argv.slice(1), { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    } catch (e: any) {
      resolve({ code: null, out: '', err: '', timedOut: false, spawnError: String(e?.message || e) })
      return
    }
    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill() } catch {}
      finish(null)
    }, timeoutMs)
    child.stdout?.on('data', (d) => { if (out.length < 8000) out += String(d) })
    child.stderr?.on('data', (d) => { if (err.length < 8000) err += String(d) })
    child.on('error', (e: any) => finish(null, String(e?.message || e)))
    child.on('close', (code: number | null) => finish(code))
  })
}

async function runCommandStep(step: ActionStep, budgetMs: number): Promise<{ ok: boolean; detail: string }> {
  const argv = Array.isArray(step.argv) ? step.argv.map((a: any) => String(a)) : []
  if (!argv.length) return { ok: false, detail: t('配方里没写 argv') }
  const cwd = step.cwd ? join(process.cwd(), String(step.cwd)) : process.cwd()
  const r = await spawnCommand(argv, cwd, timeoutOf(step, budgetMs))
  if (r.spawnError) return { ok: false, detail: t('命令起不来：{msg}', { msg: clip(r.spawnError, 160) }) }
  if (r.timedOut) return { ok: false, detail: t('命令超时（{n} 秒）被杀掉', { n: Math.round(timeoutOf(step, budgetMs) / 1000) }) }
  const tail = (r.out.trim() || r.err.trim() || '').split(/\r?\n/).filter(Boolean).slice(-1)[0] || ''
  const ok = r.code === 0
  const detail = (ok ? t('退出码 0') : t('退出码 {code}', { code: String(r.code) })) + (tail ? ' · ' + clip(tail, 200) : '')
  return { ok, detail }
}

export async function runRecipe(
  id: number,
  recipe: ActionRecipe,
  engine?: { probeNow: (id: number) => Promise<ProbeResult> }
): Promise<{ ok: boolean; steps: StepResult[] }> {
  const startedAt = Date.now()
  const steps: StepResult[] = []
  for (const step of recipe.steps) {
    const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt)
    if (remaining <= 500) {
      steps.push({ type: step.type, label: step.label, ok: false, detail: t('整套配方超过 {n} 秒，后面的步骤没跑', { n: TOTAL_BUDGET_MS / 1000 }), ms: 0 })
      break
    }
    const t0 = Date.now()
    let r: { ok: boolean; detail: string }
    try {
      if (step.type === 'kuma-check') r = await runProbeCheck(id, step, remaining, engine)
      else if (step.type === 'http') r = await runHttp(step, remaining)
      else if (step.type === 'command') r = await runCommandStep(step, remaining)
      else r = { ok: false, detail: t('不认识的步骤类型：{type}', { type: step.type }) }
    } catch (e: any) {
      r = { ok: false, detail: clip(e?.message || e, 240) }
    }
    steps.push({ type: step.type, label: step.label, ok: r.ok, detail: r.detail, ms: Date.now() - t0 })
    if (!r.ok) break
  }
  return { ok: steps.length > 0 && steps.every((s) => s.ok), steps }
}
