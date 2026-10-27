#!/usr/bin/env node
// pinboard e2e 串行 runner。
//
//   node tests/run.mjs                 # core + monitor：自己起一个隔离实例，跑完删
//   node tests/run.mjs --only=core     # 只跑便签/资产/路由
//   node tests/run.mjs --only=ci       # CI 用：core 全部 + 没接 Kuma 时的引导卡（不需要 Kuma/邮箱/采集端）
//   node tests/run.mjs --only=mail     # 邮件套件，另需 MAIL_E2E_BASE 指向隔离实例
//   node tests/run.mjs --only=all
//   node tests/run.mjs --only=outbound  # 只跑末尾那段「全局出站模式」（要真实 Kuma + KUMA_PASS）
//   OUTBOUND_E2E=1 node tests/run.mjs  # 同上：显式打开 outbound 段（它写真实 kuma，默认全量跑不含它）
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
  closeSync, copyFileSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { DatabaseSync, backup } from 'node:sqlite'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const KEEP = process.argv.includes('--keep')
const TEST_PASSWORD = 'e2e-password'

const CORE = [
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
  ['e2e-image', 'e2e-image.mjs'],
  ['e2e-tagpop-outside', 'e2e-tagpop-outside.mjs'],
  ['e2e-i18n', 'e2e-i18n.mjs'],
]

const SUITES = {
  core: CORE,
  // CI 只跑「不依赖外部服务」的那批：core 全部 + 没接 Kuma 时的引导卡。
  // monitor 组要真 Kuma、mail 组要假 IMAP 服务、主机指标要采集端，都只在本地跑。
  ci: [...CORE, ['e2e-monitor-empty', 'e2e-monitor-empty.mjs']],
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

// outbound 不是独立脚本，而是本文件末尾那一段（它连真实 Kuma，改完 setting 必须复位）。
// **默认不跑（R20）**：那一段会真的把 monitorOutboundMode / monitorOutboundProxy / monitorOutboundChangedAt
// 三条 general setting 写进用户的 kuma，还会踢一轮重探（19 条 active 项会集体变红一会儿）。
// 所以门禁是：「--only 的列表里含 outbound」或「OUTBOUND_E2E=1」才执行；
// 默认全量跑（不带 --only）、--only=core/ci/mail/monitor 一律跳过这一段。
const wantOutbound = requested.includes('outbound') || process.env.OUTBOUND_E2E === '1'

const groups = requested.includes('all') || requested.includes('default')
  ? ['core', 'monitor']
  : requested.filter((g) => g !== 'outbound')

const unknown = groups.filter((g) => !SUITES[g])
if (unknown.length) {
  console.error('[run] 不认识的套件：' + unknown.join(', ') + '（可选 core / ci / monitor / mail / outbound / all）')
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
      // 目录也要拷：data/uploads/ 放便签图片，只拷文件会让带图便签在隔离实例里 404
      if (statSync(s).isDirectory()) cpSync(s, join(dataDir, f), { recursive: true })
      else copyFileSync(s, join(dataDir, f))
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

/* ---------------- outbound：全局出站模式（这一段会真的写 Kuma 的 general settings） ---------------- */
//
// 为什么单独一段、还写得这么小心：它连的是**真实 Kuma**（默认 127.0.0.1:3001），
// POST /api/outbound 会真的把 monitorOutboundMode / monitorOutboundProxy / monitorOutboundChangedAt
// 三条 general setting 写进用户的实例。所以：
//   1. 进段先取这三条的原值，整段包在 try/finally 里，**finally 无条件**恢复（哪怕上面的断言全挂）；
//   2. 结束时打一行「复位后实测值」，方便人工确认（只打「有没有密码」，不打明文）；
//   3. 没有 Kuma 口令就 SKIP：那是环境缺凭据，不是代码坏（口令解析顺序同 server/kuma/secret.ts：
//      KUMA_PASS → 私有实例的 data/kuma-pass.txt；`enc:v1:` 的密文这里解不了，也算没有）。
//
// 断言只有一条铁律要记住：**「不修改」不许被降级成「清空」**（密码与账号都是三态）。
//
// **门禁（R20，重要）**：这一段写的是真实 kuma 的三条 general setting，并且会踢一轮重探，
// 所以它**默认不跑** —— 只有 --only 的列表里显式含 outbound、或环境变量 OUTBOUND_E2E=1 时才执行
// （判定见文件上方的 wantOutbound；默认全量跑、--only=core/ci/mail/monitor 都会跳过这一段）。
// 原因：部署后随手跑一次 --only=mail 就会把真实 kuma 切成 socks5h 127.0.0.1:1（死端口）
// 并踢一轮重探，19 条 active 观测项集体冒出一波假故障红心跳。

/** 代理配置「有没有密码」——老 kuma 回明文 password，新 kuma 回 hasPassword */
const proxyHasPassword = (raw) =>
  raw && typeof raw === 'object'
    ? (typeof raw.password === 'string' ? raw.password.length > 0 : raw.hasPassword === true)
    : false

/**
 * 进段快照里的原始代理配置 → GET 视图的 5 键形状（与 server/kuma/outbound-view.ts 的 maskProxy 同规则）。
 * 用「快照折算」而不是硬编码期望值，这样用户长期开着 proxy 时这段也是绿的（评审 M-1）。
 */
const maskSnapshot = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const port = Number(raw.port)
  return {
    protocol: typeof raw.protocol === 'string' && raw.protocol ? raw.protocol : 'socks5h',
    host: typeof raw.host === 'string' ? raw.host : '',
    port: Number.isInteger(port) ? port : 0,
    username: typeof raw.username === 'string' ? raw.username : '',
    hasPassword: typeof raw.password === 'string' ? raw.password.length > 0 : raw.hasPassword === true,
  }
}

/** 按 key 排序后再串化比较，免得「键顺序不同」被当成不一致 */
const sortedCfg = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]))

function kumaPassForE2E() {
  const fromEnv = (process.env.KUMA_PASS || '').trim()
  if (fromEnv) return fromEnv
  const dir = instance ? instance.dataDir : (process.env.PINBOARD_DATA || join(ROOT, 'data'))
  try {
    const raw = readFileSync(join(dir, 'kuma-pass.txt'), 'utf8').trim()
    // 密文（enc:v1:）要主密钥才能解，runner 里不做解密：当没有口令处理
    if (raw && !raw.startsWith('enc:v1:')) return raw
  } catch {
    /* 没有就没有 */
  }
  return ''
}

/** 开一条登录好的 Kuma socket（只用在这段里，用完关掉） */
async function openKumaSocket(password) {
  const { io } = await import('socket.io-client')
  const url = (process.env.KUMA_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '')
  const s = io(url, { timeout: 10000, reconnection: false })
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('连不上 Kuma ' + url)), 12000)
      s.once('connect_error', (e) => { clearTimeout(timer); reject(new Error('连不上 Kuma ' + url + '：' + String(e && e.message ? e.message : e))) })
      s.once('connect', () => { clearTimeout(timer); resolve(0) })
    })
    const login = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Kuma 登录超时')), 12000)
      s.emit('login', { username: process.env.KUMA_USER || 'admin', password }, (r) => { clearTimeout(timer); resolve(r) })
    })
    if (!login || !login.ok) throw new Error('Kuma 登录被拒：' + String(login && login.msg ? login.msg : '(没有回 ok)'))
  } catch (e) {
    try { s.close() } catch { /* ignore */ }
    throw e
  }

  const call = (event, ...args) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Kuma 无响应：' + event)), 20000)
    s.emit(event, ...args, (r) => {
      clearTimeout(timer)
      if (r && r.ok === false) return reject(new Error('Kuma 拒绝 ' + event + '：' + String(r.msg || '')))
      resolve(r)
    })
  })

  // getMonitorList 的 ack 里没数据，列表是随后推来的 monitorList 事件（同 server/kuma/client.ts）
  const monitorList = () => new Promise((resolve, reject) => {
    const onList = (list) => { clearTimeout(timer); s.off('monitorList', onList); resolve(list && typeof list === 'object' ? list : {}) }
    const timer = setTimeout(() => { s.off('monitorList', onList); reject(new Error('拿观测项列表超时')) }, 20000)
    s.on('monitorList', onList)
    s.emit('getMonitorList', () => { /* ack 里没数据 */ })
  })

  return { call, monitorList, close: () => { try { s.close() } catch { /* ignore */ } } }
}

/**
 * 跑完这一整段，返回 { skipped, failed }。
 * 注意顺序：**先把原值快照下来，再动任何东西**；恢复在 finally 里做，不依赖断言结果。
 */
async function runOutboundSection() {
  const password = kumaPassForE2E()
  if (!password) {
    console.log('[run] SKIP outbound：没有 Kuma 口令（设 KUMA_PASS，或让口令落在 data/kuma-pass.txt）。这段要连真实 Kuma 才能跑。')
    return { skipped: true, failed: 0 }
  }

  let kuma = null
  try {
    kuma = await openKumaSocket(password)
  } catch (e) {
    console.log('[run] ✘ outbound：' + (e && e.message ? e.message : e))
    return { skipped: false, failed: 1 }
  }

  const fails = []
  let orig = null
  let inactiveBefore = []

  const step = async (name, fn) => {
    try {
      await fn()
      console.log('PASS ' + name)
    } catch (e) {
      console.log('FAIL ' + name + '：' + (e && e.message ? e.message : e))
      fails.push(name)
    }
  }
  const eq = (actual, expected, what) => {
    if (actual !== expected) throw new Error(what + '（期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual) + '）')
  }
  const ok = (cond, what) => { if (!cond) throw new Error(what) }
  const apiCall = async (method, path, body) => {
    const init = { method, headers: { authorization: 'Bearer ' + token } }
    if (method !== 'GET') {
      init.headers['content-type'] = 'application/json'
      init.body = JSON.stringify(body === undefined ? {} : body)
    }
    const r = await fetch(base + '/api' + path, init)
    const text = await r.text()
    let data
    try { data = JSON.parse(text) } catch { data = text }
    if (!r.ok) {
      throw new Error(method + ' ' + path + ' -> HTTP ' + r.status + '：' + (typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data)))
    }
    return data
  }
  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))

  try {
    // ---- 快照（在做任何写入之前）----
    const s0 = (await kuma.call('getSettings')).data || {}
    const has = (k) => Object.prototype.hasOwnProperty.call(s0, k)
    orig = {
      mode: has('monitorOutboundMode') ? s0.monitorOutboundMode : undefined,
      proxy: has('monitorOutboundProxy') ? s0.monitorOutboundProxy : undefined,
      changedAt: has('monitorOutboundChangedAt') ? s0.monitorOutboundChangedAt : undefined,
    }
    const list0 = await kuma.monitorList()
    inactiveBefore = Object.values(list0).filter((m) => !m.active).map((m) => Number(m.id)).sort((a, b) => a - b)
    console.log('[run] outbound 进段快照：mode=' + (orig.mode === undefined ? '(未设置)' : String(orig.mode))
      + '，proxy=' + (orig.proxy ? '已配置' : '(未设置)')
      + '，changedAt=' + (orig.changedAt === undefined ? '(未设置)' : String(orig.changedAt))
      + '，停用项 [' + inactiveBefore.join(',') + ']')

    // ---- brief 的 5 条 ----
    await step('outbound.get.defaults', async () => {
      // 不复硬编码 direct（评审 M-1）：真实 kuma 可以按设计长期开着 proxy，那时硬断言 direct 必然误红。
      // 这里比的是**进段快照**：进段读到的 mode / proxy / changedAt 原值，读接口必须一模一样地给回来。
      const r = await apiCall('GET', '/outbound')
      const wantMode = orig.mode === 'proxy' ? 'proxy' : 'direct'
      eq(r.mode, wantMode, 'GET 的 mode 必须等于进段快照（键缺失 / 非 proxy 一律折算 direct）')
      const wantProxy = maskSnapshot(orig.proxy)
      if (wantProxy === null) {
        eq(r.proxy, null, 'GET 的 proxy：进段快照里没有代理配置时必须回 null')
      } else {
        ok(r.proxy && typeof r.proxy === 'object', 'GET 的 proxy 必须是对象（快照里有代理配置，实际 ' + JSON.stringify(r.proxy) + '）')
        eq(Object.keys(r.proxy).sort().join(','), 'hasPassword,host,port,protocol,username', 'GET 的 proxy 只允许 5 个键')
        eq(JSON.stringify(sortedCfg(r.proxy)), JSON.stringify(sortedCfg(wantProxy)),
          'GET 的 proxy 必须等于进段快照按掩码规则折算后的五项')
      }
      const wantAt = typeof orig.changedAt === 'string' && orig.changedAt ? orig.changedAt : null
      eq(r.changedAt, wantAt, 'GET 的 changedAt 必须等于进段快照')
    })

    await step('outbound.post.proxy.keeps.entryPage', async () => {
      const before = (await kuma.call('getSettings')).data.entryPage
      const r = await apiCall('POST', '/outbound', {
        mode: 'proxy',
        proxy: { protocol: 'socks5h', host: '127.0.0.1', port: 1, username: '', password: 'e2e-secret' },
      })
      eq(r.mode, 'proxy', 'POST proxy 之后响应里的 mode')
      eq(r.proxy && r.proxy.hasPassword, true, 'POST proxy 之后响应里的 hasPassword')
      ok(typeof r.rechecking === 'number' && r.rechecking > 0, 'POST 响应要带 rechecking 条数（> 0），实际 ' + String(r.rechecking))
      const after = (await kuma.call('getSettings')).data.entryPage
      eq(after, before, '整包写设置后 entryPage 必须没变')
    })

    await step('outbound.get.masks.password', async () => {
      const raw = JSON.stringify(await apiCall('GET', '/outbound'))
      ok(!raw.includes('e2e-secret'), 'GET 响应体不得含明文密码')
      const g = await apiCall('GET', '/outbound')
      eq(g.proxy.hasPassword, true, 'GET 的 hasPassword')
      ok(!('password' in g.proxy), 'GET 的 proxy 里不许有 password 键')
    })

    await step('outbound.post.without.password.keeps.it', async () => {
      await apiCall('POST', '/outbound', { mode: 'proxy', proxy: { protocol: 'socks5h', host: '127.0.0.1', port: 1, username: '' } })
      eq((await apiCall('GET', '/outbound')).proxy.hasPassword, true, '省略 password 后 hasPassword 必须保持 true（「不修改」不许降级成「清空」）')
    })

    await step('outbound.recheck.leaves.inactive.monitors.alone', async () => {
      // 前面几次 POST 都会顺手踢一轮，互斥会把并发的这一轮挡掉（queued 回 0）—— 所以允许重试
      let queued = 0
      for (let i = 0; i < 6 && queued === 0; i += 1) {
        await sleepMs(3000)
        queued = (await apiCall('POST', '/outbound/recheck')).queued
      }
      ok(queued > 0, '重探必须真的排上条目（queued > 0）')
      await sleepMs(4000)
      const list = await kuma.monitorList()
      const inactiveNow = Object.values(list).filter((m) => !m.active).map((m) => Number(m.id)).sort((a, b) => a - b)
      eq(inactiveNow.join(','), inactiveBefore.join(','), '重探后停用项清单必须一个都没被点亮')
      console.log('[run] 停用项 [' + inactiveNow.join(',') + ']（进段时 [' + inactiveBefore.join(',') + ']）')
    })

    // ---- 评审要求补的 3 条（三态回归）----
    await step('outbound.post.clear.password', async () => {
      await apiCall('POST', '/outbound', {
        mode: 'proxy',
        proxy: { protocol: 'socks5h', host: '127.0.0.1', port: 1, username: '', password: null },
      })
      const g = await apiCall('GET', '/outbound')
      eq(g.proxy.hasPassword, false, 'password:null 之后 hasPassword 必须是 false（清空密码这条路要通）')
    })

    await step('outbound.post.clear.username', async () => {
      const set = await apiCall('POST', '/outbound', {
        mode: 'proxy',
        proxy: { protocol: 'socks5h', host: '127.0.0.1', port: 1, username: 'e2e-user', password: 'e2e-secret' },
      })
      eq(set.proxy.username, 'e2e-user', '先写入账号')
      await apiCall('POST', '/outbound', { mode: 'proxy', proxy: { protocol: 'socks5h', host: '127.0.0.1', port: 1, username: null } })
      const g = await apiCall('GET', '/outbound')
      eq(g.proxy.username, '', 'username:null 之后 username 必须是空串（= 清空账号）')
      eq(g.proxy.hasPassword, true, '清账号不该把密码一起清掉')
    })

    await step('outbound.post.omit.password.after.reset.keeps.it', async () => {
      await apiCall('POST', '/outbound', {
        mode: 'proxy',
        proxy: { protocol: 'socks5h', host: '127.0.0.1', port: 2, username: 'e2e-user', password: 'e2e-secret-2' },
      })
      eq((await apiCall('GET', '/outbound')).proxy.hasPassword, true, '重设密码后 hasPassword')
      // 这一条是「不修改」的独立证据：换一组 host/port/账号，只省略 password 键
      await apiCall('POST', '/outbound', { mode: 'proxy', proxy: { protocol: 'socks5h', host: '127.0.0.1', port: 2, username: 'e2e-user' } })
      const g = await apiCall('GET', '/outbound')
      eq(g.proxy.hasPassword, true, '省略 password 键后 hasPassword 必须仍是 true')
      eq(g.proxy.username, 'e2e-user', '省略 username 键后账号也必须保留')
      eq(g.proxy.port, 2, '同一次写入里的端口改动要生效（说明不是整包被忽略）')
    })

    await step('outbound.post.direct.keeps.proxy', async () => {
      const r = await apiCall('POST', '/outbound', { mode: 'direct' })
      eq(r.mode, 'direct', 'POST direct 之后响应里的 mode')
      const raw = (await kuma.call('getSettings')).data.monitorOutboundProxy
      ok(raw && typeof raw === 'object', 'direct 之后 monitorOutboundProxy 必须还在（不许因为切直连就清空配置）')
      eq(raw.host, '127.0.0.1', 'direct 之后代理主机应保留')
      eq(proxyHasPassword(raw), true, 'direct 之后代理密码应保留')
    })
  } catch (e) {
    console.log('FAIL outbound.prepare：' + (e && e.message ? e.message : e))
    fails.push('outbound.prepare')
  } finally {
    // ---- 无条件复位：这三条 general setting 是本段改的，必须还回去 ----
    try {
      const cur = (await kuma.call('getSettings')).data || {}
      const restore = { ...cur }
      restore.monitorOutboundMode = orig && orig.mode !== undefined ? orig.mode : 'direct'
      restore.monitorOutboundProxy = orig && orig.proxy !== undefined ? orig.proxy : null
      // setSettings 只能写不能删键：原来没有 changedAt 时写 null（读侧等价于「没改过」）
      restore.monitorOutboundChangedAt = orig && orig.changedAt !== undefined ? orig.changedAt : null
      // setSettings 的第二个参数是 currentPassword：必须显式给，不然 ack 回调会被当成它、永远不回（实测 20s 超时）
      await kuma.call('setSettings', restore, null)

      const back = (await kuma.call('getSettings')).data || {}
      const p2 = back.monitorOutboundProxy
      console.log('[run] outbound 复位后实测：mode=' + (back.monitorOutboundMode === 'proxy' ? 'proxy' : 'direct')
        + '，proxy=' + (p2 && typeof p2 === 'object' ? String(p2.protocol) + ' ' + String(p2.host) + ':' + String(p2.port) : 'null')
        + '，hasPassword=' + (p2 && typeof p2 === 'object' ? String(proxyHasPassword(p2)) : '-')
        + '，changedAt=' + (typeof back.monitorOutboundChangedAt === 'string' ? back.monitorOutboundChangedAt : 'null'))
    } catch (e) {
      console.log('[run] ⚠ outbound 复位失败，请手工检查 Kuma 的「设置 → 出站模式」：' + (e && e.message ? e.message : e))
      fails.push('outbound.restore')
    } finally {
      if (kuma) kuma.close()
    }
  }

  return { skipped: false, failed: fails.length }
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

  // 末尾这一段不是子进程脚本：它直接打私有实例的 /api/outbound，并自己连真实 Kuma 做快照 / 复位。
  // 门禁（R20）：只有 --only=outbound 或 OUTBOUND_E2E=1 才跑 —— 它会写真实 kuma 的三条 general setting。
  if (wantOutbound) {
    process.stdout.write('\n[run] ▶ outbound/outbound\n')
    const ob = await runOutboundSection()
    if (ob.skipped) {
      console.log('[run] ⊘ outbound（跳过：没有 Kuma 口令）')
    } else if (ob.failed) {
      failed.push('outbound')
      console.log('[run] ✘ outbound（' + ob.failed + ' 条断言失败）')
    } else {
      passed += 1
      console.log('[run] ✔ outbound')
    }
  } else {
    console.log('\n[run] ⊘ 跳过 outbound 段（它会写真实 Kuma 的三条 general setting：只在 --only=outbound 或 OUTBOUND_E2E=1 时跑）')
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
