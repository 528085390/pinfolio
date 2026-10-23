#!/usr/bin/env node
// pinboard e2e 串行 runner。
//
//   node tests/run.mjs                 # core + monitor：自己起一个隔离实例，跑完删
//   node tests/run.mjs --only=core     # 只跑便签/资产/路由
//   node tests/run.mjs --only=mail     # 邮件套件，另需 MAIL_E2E_BASE 指向隔离实例
//   node tests/run.mjs --only=all
//   node tests/run.mjs --keep          # 保留临时数据目录，排查用
//   E2E_BASE=http://127.0.0.1:7791 node tests/run.mjs   # 打已有实例，不再自己起
//
// **规矩：测试数据不许和真实数据放一起。** 默认模式把 data/ 快照到临时目录、
// 清掉密码/会话/token 再起一个私有实例（PINBOARD_DATA 指向临时目录），
// 跑完连目录一起删——真实库一个字节都不碰。说明见 tests/README.md。
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { DatabaseSync, backup } from 'node:sqlite'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const KEEP = process.argv.includes('--keep')
const TEST_PASSWORD = 'e2e-password'

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
    ['e2e-monitor-beat-tip', 'e2e-monitor-beat-tip.mjs'],
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

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
  })
}

function tailLog(file) {
  try {
    const lines = readFileSync(file, 'utf8').trimEnd().split('\n')
    return lines.slice(-15).join('\n')
  } catch {
    return '(没有日志)'
  }
}

async function waitHealth(base, child, logPath, timeoutMs = 90000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) throw new Error('实例退出（exit ' + child.exitCode + '）：\n' + tailLog(logPath))
    try {
      const r = await fetch(base + '/api/health', { signal: AbortSignal.timeout(2000) })
      if (r.ok) return
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('等不到 ' + base + '/api/health：\n' + tailLog(logPath))
}

// 起一个私有实例：真实库只读快照到临时目录，配置小文件照搬，身份（密码/会话/token/公网地址）清空。
async function startIsolated() {
  const dataDir = join(tmpdir(), 'pinfolio-e2e-' + Date.now())
  mkdirSync(dataDir, { recursive: true })

  const liveDir = join(ROOT, 'data')
  if (existsSync(liveDir)) {
    for (const f of readdirSync(liveDir)) {
      if (f.startsWith('pinboard.db')) continue
      const s = join(liveDir, f)
      if (statSync(s).isFile()) copyFileSync(s, join(dataDir, f))
    }
  }

  const tempDb = join(dataDir, 'pinboard.db')
  const liveDb = join(liveDir, 'pinboard.db')
  if (existsSync(liveDb)) {
    const src = new DatabaseSync(liveDb)
    try {
      await backup(src, tempDb) // WAL 下热拷会丢数据，必须走 backup()
    } finally {
      src.close()
    }
  }
  if (existsSync(tempDb)) {
    const db = new DatabaseSync(tempDb)
    try {
      // 不带真实密码、会话、token；也不带公网地址（免得隔离实例去探真实域名）
      db.exec("DELETE FROM settings WHERE key = 'password_hash' OR key LIKE 'tunnel.%'")
      db.exec('DELETE FROM sessions')
      db.exec('DELETE FROM api_tokens')
    } finally {
      db.close()
    }
  }

  const port = await freePort()
  const logPath = join(dataDir, 'server.log')
  const fd = openSync(logPath, 'a')
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PINBOARD_DATA: dataDir,
      PORT: String(port),
      HOST: '127.0.0.1',
      PINBOARD_PASSWORD: TEST_PASSWORD,
      PINBOARD_TOKEN: '',
      TRUST_PROXY: '',
      E2E_BASE: '',
      MAIL_E2E_BASE: '',
    },
    stdio: ['ignore', fd, fd],
    windowsHide: true,
  })
  closeSync(fd)

  const base = 'http://127.0.0.1:' + port
  await waitHealth(base, child, logPath)
  return { base, dataDir, child, logPath }
}

// 鉴权：fetch 型脚本靠 API token（写进 api_tokens，名字固定 e2e，重跑先删旧的），
// 浏览器脚本靠 PINBOARD_PASSWORD 走登录页（见 tests/login.mjs）。
function makeToken(dbFile) {
  if (process.env.PINBOARD_TOKEN) return process.env.PINBOARD_TOKEN
  if (!existsSync(dbFile)) {
    console.error('[run] 找不到数据库 ' + dbFile + '；设 PINBOARD_TOKEN 可跳过自动发 token')
    process.exit(2)
  }
  const db = new DatabaseSync(dbFile)
  try {
    db.prepare("DELETE FROM api_tokens WHERE name = 'e2e'").run()
    const token = 'pb_' + randomBytes(32).toString('base64url')
    db.prepare('INSERT INTO api_tokens (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(randomBytes(8).toString('hex'), 'e2e', createHash('sha256').update(token).digest('hex'), new Date().toISOString())
    return token
  } finally {
    db.close()
  }
}

let instance = null
async function stopInstance() {
  if (!instance) return
  const { child, dataDir } = instance
  instance = null
  if (child.exitCode === null) {
    child.kill()
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 5000)
      child.once('exit', () => { clearTimeout(t); resolve() })
    })
  }
  if (KEEP) {
    console.log('[run] --keep：保留临时数据目录 ' + dataDir)
    return
  }
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  } catch (e) {
    console.warn('[run] 临时目录没删干净：' + dataDir + '（' + e.message + '）')
  }
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await stopInstance(); process.exit(130) })

const external = (process.env.E2E_BASE || '').replace(/\/+$/, '')
let base
if (external) {
  if (/:7788\b/.test(external)) {
    console.warn('[run] ⚠ E2E_BASE 指向 7788（通常是真实实例）：测试会往那个库里写便签/资产，确认它不是你自己的库。')
  }
  try {
    const r = await fetch(external + '/api/health', { signal: AbortSignal.timeout(5000) })
    if (!r.ok) throw new Error('HTTP ' + r.status)
  } catch (e) {
    console.error('[run] 连不上 ' + external + '/api/health：' + e.message)
    process.exit(2)
  }
  base = external
  console.log('[run] 用已有实例 ' + base + '（不再自己起隔离实例）')
} else {
  instance = await startIsolated()
  base = instance.base
  console.log('[run] 隔离实例 ' + base + '（数据 ' + instance.dataDir + '，跑完删除）')
}

const token = makeToken(join(instance ? instance.dataDir : (process.env.PINBOARD_DATA || join(ROOT, 'data')), 'pinboard.db'))
const shim = pathToFileURL(join(ROOT, 'tests', 'auth-shim.mjs')).href

// e2e-alert 默认打 7799；跟着当前目标实例走，避免默认值把测试引到不存在的端口。
const env = {
  ...process.env,
  E2E_BASE: base,
  ALERT_E2E_BASE: process.env.ALERT_E2E_BASE || base,
  PINBOARD_TOKEN: token,
  PINBOARD_PASSWORD: instance ? TEST_PASSWORD : (process.env.PINBOARD_PASSWORD || ''),
}

const failed = []
let passed = 0
const startedAll = Date.now()

try {
  for (const group of groups) {
    for (const [name, file] of SUITES[group]) {
      process.stdout.write('\n[run] ▶ ' + group + '/' + name + '\n')
      const started = Date.now()
      const code = await new Promise((resolve) => {
        const child = spawn(process.execPath, ['--import', shim, join(ROOT, 'tests', file)], {
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
} finally {
  await stopInstance()
}

const total = passed + failed.length
console.log('\n[run] ===== 汇总：' + passed + '/' + total + ' 通过，用时 ' + Math.round((Date.now() - startedAll) / 1000) + 's =====')
if (failed.length) {
  console.log('[run] 失败：' + failed.join(', '))
  process.exit(1)
}
