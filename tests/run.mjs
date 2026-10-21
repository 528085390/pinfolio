#!/usr/bin/env node
// pinboard e2e 串行 runner。
//
//   node tests/run.mjs                  # core + monitor（需要 pinboard 在 7788、Kuma 在 3001）
//   node tests/run.mjs --only=core      # 只跑便签/资产/路由
//   node tests/run.mjs --only=mail      # 邮件套件，必须先设 MAIL_E2E_BASE 指向隔离实例
//   node tests/run.mjs --only=all       # 全部（mail 仍需隔离实例）
//
// 说明见 tests/README.md。
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const SUITES = {
  core: [
    ['smoke', 'smoke.mjs'],
    ['e2e', 'e2e.mjs'],
    ['done-smoke', 'done-smoke.mjs'],
    ['e2e-done', 'e2e-done.mjs'],
    ['e2e-dblclick', 'e2e-dblclick.mjs'],
    ['e2e-filter', 'e2e-filter.mjs'],
    ['e2e-archive', 'e2e-archive.mjs'],
    ['e2e-tagbar', 'e2e-tagbar.mjs'],
    ['e2e-router', 'e2e-router.mjs'],
    ['e2e-tagpop', 'e2e-tagpop.mjs'],
    ['e2e-tagpop-outside', 'e2e-tagpop-outside.mjs'],
  ],
  monitor: [
    ['e2e-monitor-note', 'e2e-monitor-note.mjs'],
    ['e2e-monitor-drawer', 'e2e-monitor-drawer.mjs'],
    ['e2e-alert', 'e2e-alert.mjs'],
  ],
  mail: [
    ['e2e-mail', 'e2e-mail.mjs'],
    ['mail-api-smoke', 'fakeimap/mail-api-smoke.mjs'],
  ],
}

const onlyArg = process.argv.slice(2).find((a) => a.startsWith('--only='))
const requested = (onlyArg ? onlyArg.slice('--only='.length) : 'default')
  .split(',').map((s) => s.trim()).filter(Boolean)

const groups = requested.includes('all') || requested.includes('default')
  ? ['core', 'monitor']
  : requested

const unknown = groups.filter((g) => !SUITES[g])
if (unknown.length) {
  console.error('[run] 不认识的套件：' + unknown.join(', ') + '（可选 core / monitor / mail / all）')
  process.exit(2)
}

if (groups.includes('mail') && !process.env.MAIL_E2E_BASE) {
  console.error('[run] mail 套件必须指向隔离实例：先设置 MAIL_E2E_BASE（见 tests/README.md）')
  process.exit(2)
}

const base = (process.env.MAIL_E2E_BASE || process.env.E2E_BASE || 'http://127.0.0.1:7788').replace(/\/+$/, '')

try {
  const r = await fetch(base + '/api/health', { signal: AbortSignal.timeout(5000) })
  const j = await r.json().catch(() => null)
  if (!r.ok || !j?.ok) throw new Error('HTTP ' + r.status)
} catch (e) {
  console.error('[run] 连不上 ' + base + '/api/health：' + e.message)
  console.error('[run] 先启动 pinboard（pnpm start），邮件套件按 tests/README.md 起隔离实例。')
  process.exit(2)
}

// e2e-alert 默认打 7799；跟着当前目标实例走，避免默认值把测试引到不存在的端口。
const env = { ...process.env, ALERT_E2E_BASE: process.env.ALERT_E2E_BASE || base }

const failed = []
let passed = 0
const startedAll = Date.now()

for (const group of groups) {
  for (const [name, file] of SUITES[group]) {
    process.stdout.write('\n[run] ▶ ' + group + '/' + name + '\n')
    const started = Date.now()
    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, [join(ROOT, 'tests', file)], {
        cwd: ROOT,
        env,
        stdio: 'inherit',
        windowsHide: true,
      })
      child.on('error', (e) => { console.error('[run] 启动失败：' + e.message); resolve(1) })
      child.on('exit', (c, signal) => resolve(c ?? (signal ? 1 : 0)))
    })
    const ms = Date.now() - started
    if (code === 0) { passed += 1; console.log('[run] ✔ ' + name + ' (' + ms + 'ms)') }
    else { failed.push(name); console.log('[run] ✘ ' + name + ' (exit ' + code + ', ' + ms + 'ms)') }
  }
}

const total = passed + failed.length
console.log('\n[run] ===== 汇总：' + passed + '/' + total + ' 通过，用时 ' + Math.round((Date.now() - startedAll) / 1000) + 's =====')
if (failed.length) {
  console.log('[run] 失败：' + failed.join(', '))
  process.exit(1)
}
