import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { getBeats, kickCheck } from './client.js'
import { clip, statusText, timeoutOf, type ActionRecipe, type ActionStep } from './recipe.js'

// 「立即观测」的执行器：kuma-check / http / command 三种步骤 + 按顺序跑完整套配方。
// 配方的解析与挑选在 recipe.ts（纯函数），这里只负责真的去做。

/** 一步执行完的回显：抽屉里一行一条。 */
export type StepResult = {
  type: string
  label: string
  /** 这一步「跑成功了没有」——不是观测项的最终状态（kuma-check 探到故障也算执行成功） */
  ok: boolean
  detail: string
  ms: number
}

/** 整套配方最多跑 60 秒，超了就不再往下走（抽屉里按钮不至于一直转）。 */
const TOTAL_BUDGET_MS = 60_000

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 让 Kuma 立刻探一次，然后等一条新心跳出现（拿它当这一步的结果）。 */
async function runKumaCheck(id: number, step: ActionStep, budgetMs: number): Promise<{ ok: boolean; detail: string }> {
  const before = (await getBeats(id, 1).catch(() => [])).slice(-1)[0] || null
  await kickCheck(id)

  const deadline = Date.now() + timeoutOf(step, budgetMs)
  while (Date.now() < deadline) {
    await sleep(400)
    const beats = await getBeats(id, 1).catch(() => [])
    const last = beats[beats.length - 1]
    if (!last) continue
    const changed = !before || String(last.time) !== String(before.time)
    if (changed) {
      return { ok: true, detail: statusText(Number(last.status)) + ' · ' + clip(last.msg || '（无消息）', 200) }
    }
  }
  return { ok: false, detail: '重启检查循环后 ' + Math.round(timeoutOf(step, budgetMs) / 1000) + ' 秒内没有产生新心跳' }
}

/** 发一个 HTTP 请求，优先读响应 JSON 里的 message 字段当结果。 */
async function runHttp(step: ActionStep, budgetMs: number): Promise<{ ok: boolean; detail: string }> {
  const url = String(step.url || '')
  if (!url) return { ok: false, detail: '配方里没写 url' }
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

/** 跑一条命令（argv 数组，不经 shell）。 */
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
  if (!argv.length) return { ok: false, detail: '配方里没写 argv' }
  const cwd = step.cwd ? join(process.cwd(), String(step.cwd)) : process.cwd()
  const r = await spawnCommand(argv, cwd, timeoutOf(step, budgetMs))
  if (r.spawnError) return { ok: false, detail: '命令起不来：' + clip(r.spawnError, 160) }
  if (r.timedOut) return { ok: false, detail: '命令超时（' + Math.round(timeoutOf(step, budgetMs) / 1000) + ' 秒）被杀掉' }
  const tail = (r.out.trim() || r.err.trim() || '').split(/\r?\n/).filter(Boolean).slice(-1)[0] || ''
  const ok = r.code === 0
  const detail = (ok ? '退出码 0' : '退出码 ' + r.code) + (tail ? ' · ' + clip(tail, 200) : '')
  return { ok, detail }
}

/**
 * 按顺序跑完一套配方：失败即中止，整体 60 秒上限，每步单独计时。
 * 返回逐步回显（含失败的那一步），由调用方决定 HTTP 状态码。
 */
export async function runRecipe(id: number, recipe: ActionRecipe): Promise<{ ok: boolean; steps: StepResult[] }> {
  const startedAt = Date.now()
  const steps: StepResult[] = []
  for (const step of recipe.steps) {
    const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt)
    if (remaining <= 500) {
      steps.push({ type: step.type, label: step.label, ok: false, detail: '整套配方超过 ' + TOTAL_BUDGET_MS / 1000 + ' 秒，后面的步骤没跑', ms: 0 })
      break
    }
    const t0 = Date.now()
    let r: { ok: boolean; detail: string }
    try {
      if (step.type === 'kuma-check') r = await runKumaCheck(id, step, remaining)
      else if (step.type === 'http') r = await runHttp(step, remaining)
      else if (step.type === 'command') r = await runCommandStep(step, remaining)
      else r = { ok: false, detail: '不认识的步骤类型：' + step.type }
    } catch (e: any) {
      r = { ok: false, detail: clip(e?.message || e, 240) }
    }
    steps.push({ type: step.type, label: step.label, ok: r.ok, detail: r.detail, ms: Date.now() - t0 })
    if (!r.ok) break // 失败即中止
  }
  return { ok: steps.length > 0 && steps.every((s) => s.ok), steps }
}
