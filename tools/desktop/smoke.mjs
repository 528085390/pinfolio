#!/usr/bin/env node
// pinfolio 桌面端**打包产物**冒烟（spec 2026-10-27-pinfolio-desktop / Task 10）。
//
//   node tools/desktop/smoke.mjs                        # 默认 release/win-unpacked/pinfolio.exe
//   node tools/desktop/smoke.mjs --exe=<path>           # 指到别处的 pinfolio.exe
//   node tools/desktop/smoke.mjs --keep                 # 跑完保留临时目录（排查用）
//
// 它做的是「真起一个打包好的 Electron，真看窗口、真写一条便签，再收拾干净」：
//   1. 起 release/win-unpacked/pinfolio.exe，userData 指到临时目录（--user-data-dir），
//      数据目录（PINBOARD_DATA）也在临时目录里 —— **绝不碰用户的 %APPDATA%\pinfolio，
//      更不碰真实库 data/pinboard.db**；
//   2. 端口从 <userData>/logs/main.log 里最新的 listening on http://127.0.0.1:<port> 取
//      （打包态 GUI 进程没有 stdout，Task 7 实测：stdio:'pipe' 一个字节都抓不到）；
//   3. GET /api/health → 200；playwright-core 连 --remote-debugging-port 的 CDP，
//      截图 tmp/desktop-smoke.png，断言标题含 pinfolio、没停在 /login 或 /setup、
//      便签页外壳（.page-notes + 输入框）真的渲染出来了；
//   4. 在**渲染进程里** fetch POST /api/notes → 201（带 cookie，桌面端免密就靠这张票），
//      刷新一次确认这条便签真的出现在列表里（写进去的东西读得回来）；
//   5. taskkill /PID <pid> /T /F，确认进程没了、端口真的拒绝连接，删临时目录，退出码 0。
//
// 失败一律退出码 1，并把 main.log 最后 40 行打出来 ——「失败了」这三个字没有信息量。
//
// 三条与 Electron 有关的坑（都踩过，别删）：
//   - 必须删掉 ELECTRON_RUN_AS_NODE：本机 shell 里有它，带着传给 exe 会让它退化成纯 node，
//     不开窗、日志里报 does not provide an export named 'BrowserWindow' —— 那是假象；
//   - 必须补 SystemDrive=C:：Chromium 拿它拼缓存路径，缺了就在**当前工作目录**里造一个
//     字面量 %SystemDrive% 垃圾目录；
//   - 不新增依赖：playwright-core 已在 devDependencies，且**不装浏览器**（连的是已经跑起来
//     的那个 Electron，不是 chromium.launch()）。
import { spawn } from 'node:child_process'
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync,
} from 'node:fs'
import { rm as rmAsync } from 'node:fs/promises'
import { connect, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DEFAULT_EXE = join(ROOT, 'release', 'win-unpacked', 'pinfolio.exe')
const SHOT = join(ROOT, 'tmp', 'desktop-smoke.png')

/** 日志里等端口的上限：冷启动 + 建库够用了，再久就是真的没起来 */
const BOOT_TIMEOUT_MS = 30_000
/** 端口拿到之后等 /api/health 200 的时间 */
const HEALTH_TIMEOUT_MS = 10_000
/** CDP 端点 + 目标页面上限 */
const CDP_TIMEOUT_MS = 20_000
/** 单条 DOM 轮询上限 */
const PAGE_TIMEOUT_MS = 15_000
/** 截图小于这个字节数基本就是一张空白页（纯色 PNG 压完只有几 KB） */
const SHOT_MIN_BYTES = 20_000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 临时目录的基座。**不能直接用 os.tmpdir()**：它本身就是按 TEMP/TMP 算的，
 * 这两个变量在某些自动化环境里是空的，Node 会返回一个不存在的怪路径（本机实测
 * 会得到字面量 "undefined\\temp"），mkdtemp 直接 ENOENT。所以挑第一个真实存在的。
 */
function tempBase() {
  for (const c of [process.env.TEMP, process.env.TMP, tmpdir()]) {
    if (c && existsSync(c)) return c
  }
  return process.cwd()
}

function say(...parts) {
  console.log('[smoke]', ...parts)
}

/** 断言失败用这个抛：外层负责打日志尾巴 + 收拾现场 */
class SmokeError extends Error {}

function fail(msg) {
  throw new SmokeError(msg)
}

/** 解析命令行：只认 --exe=<path> / --exe <path> / --keep，其余直接报错（别静默忽略拼错的参数） */
function parseArgs(argv) {
  let exe = DEFAULT_EXE
  let keep = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--exe=')) {
      exe = a.slice('--exe='.length)
    } else if (a === '--exe') {
      const next = argv[++i]
      if (!next) fail('--exe 后面要跟一个 pinfolio.exe 的路径')
      exe = next
    } else if (a === '--keep') {
      keep = true
    } else {
      fail('不认识的参数：' + a + '（可用 --exe=<path> / --keep）')
    }
  }
  if (!exe) fail('--exe 指向了空路径')
  return { exe: resolve(exe), keep }
}

/** 让系统给一个空闲端口（给 --remote-debugging-port 用） */
function freePort() {
  return new Promise((ok, no) => {
    const srv = createServer()
    srv.once('error', no)
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => ok(port))
    })
  })
}

/** 端口是不是真的没人听了：连上去被拒（ECONNREFUSED）才算释放 */
function portRefused(port) {
  return new Promise((ok) => {
    const sock = connect({ port, host: '127.0.0.1' })
    let settled = false
    const done = (refused) => {
      if (settled) return
      settled = true
      sock.destroy()
      ok(refused)
    }
    sock.setTimeout(1000, () => done(false))
    sock.once('connect', () => done(false))
    sock.once('error', (err) => done(err.code === 'ECONNREFUSED'))
  })
}

/** 递归统计目录：文件数 + 总字节数（目录不存在返回 null）。用来证明「用户数据一个字节都没动」 */
function dirStats(dir) {
  if (!existsSync(dir)) return null
  let files = 0
  let bytes = 0
  const walk = (d) => {
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile()) {
        files++
        try {
          bytes += statSync(p).size
        } catch {
          /* 统计期间被删了，忽略 */
        }
      }
    }
  }
  walk(dir)
  return { files, bytes }
}

/** 日志尾部（失败时唯一的现场） */
function readTail(file, lines) {
  try {
    const all = readFileSync(file, 'utf8').split(/\r?\n/)
    while (all.length > 0 && all[all.length - 1] === '') all.pop()
    return all.slice(-lines)
  } catch {
    return []
  }
}

/**
 * 删临时目录，最多等 15 秒。
 *
 * Windows 上刚杀掉的进程还会攥着它当 cwd 几秒钟（实测 ~3 秒），这段时间 rm 一直 EBUSY/EPERM。
 * 所以这里自己写轮询重试 —— rmSync 的 maxRetries 在这种「根目录本身被占用」的场景下没帮上忙
 * （本机实测重试窗口给到 5 秒仍然 EPERM）。
 */
async function removeDir(dir, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      await rmAsync(dir, { recursive: true, force: true })
      return null
    } catch (err) {
      if (Date.now() >= deadline) return err
      await sleep(250)
    }
  }
}

/** 从日志文本里取**最新一条** listening on <url>（重启过也有多条，最后一条才是当前端口） */
function lastListening(text) {
  const re = /listening on (http:\/\/127\.0\.0\.1:\d+)/g
  let m
  let last = null
  while ((m = re.exec(text)) !== null) last = m[1]
  return last
}

/** 轮询日志文件（首选）与 stdout（开发态回退），拿到 baseUrl */
async function waitForBaseUrl(logFile, childOut, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    let fromFile = null
    try {
      if (existsSync(logFile)) fromFile = lastListening(readFileSync(logFile, 'utf8'))
    } catch {
      /* 日志正在被写、文件暂时读不了：下一轮再试 */
    }
    const url = fromFile ?? lastListening(childOut.text)
    if (url) return { url, source: fromFile ? '日志文件' : 'stdout' }
    await sleep(200)
  }
  return null
}

/** 等 /api/health 200 */
async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseUrl + '/api/health', { signal: AbortSignal.timeout(2000) })
      if (res.status === 200) return await res.json().catch(() => null)
      last = 'HTTP ' + res.status
    } catch (err) {
      last = err && err.message ? err.message : String(err)
    }
    await sleep(200)
  }
  fail('GET /api/health 在 ' + timeoutMs + 'ms 内没有返回 200（最后一次：' + (last || '无响应') + '）')
}

/** 在已连上的 CDP 里找「URL 以 baseUrl 开头」的那个页面（Electron 只有一个主窗口） */
function findPage(browser, baseUrl) {
  for (const ctx of browser.contexts()) {
    for (const page of ctx.pages()) {
      if (page.url().startsWith(baseUrl)) return page
    }
  }
  return null
}

/**
 * 连 CDP 并等到主窗口页面出现。
 * 连不上（DevTools 端点还没起来）或连上了但页面还是 about:blank，都要重试：
 * 这两件事在 Electron 冷启动里都会发生，一次失败就退出属于误报。
 */
async function openWindowPage(cdpPort, baseUrl, timeoutMs) {
  const endpoint = 'http://127.0.0.1:' + cdpPort
  const deadline = Date.now() + timeoutMs
  let lastErr = null
  let browser = null
  try {
    while (Date.now() < deadline) {
      try {
        if (browser === null) browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 })
        const page = findPage(browser, baseUrl)
        if (page) return { browser, page }
        lastErr = new Error('CDP 已连上，但还没有 URL 以 ' + baseUrl + ' 开头的页面')
      } catch (err) {
        lastErr = err
        // 连不上就把半截连接丢掉，下一轮重连（别拿着一个坏掉的 browser 反复试）
        if (browser) {
          await browser.close().catch(() => {})
          browser = null
        }
      }
      await sleep(300)
    }
  } catch (err) {
    if (browser) await browser.close().catch(() => {})
    throw err
  }
  if (browser) await browser.close().catch(() => {})
  fail('连不上 CDP ' + endpoint + '（' + timeoutMs + 'ms）：' + (lastErr && lastErr.message ? lastErr.message : String(lastErr)))
}

/** 杀掉整棵进程树（Electron 主进程 + GPU/渲染子进程），并等它真的消失 */
async function killTree(pid) {
  if (process.platform !== 'win32') {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* 已经没了 */
    }
    return
  }
  const taskkill = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe')
  await new Promise((done) => {
    const p = spawn(taskkill, ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    p.once('exit', () => done())
    p.once('error', () => done())
  })
}

/** 进程还活着吗（signal 0 = 只探存在性，不真发信号） */
function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    // 参数错了就直说，别甩一坨栈（这和「构建产物没打」是同一类使用错误）
    console.error('[smoke] ✗ ' + (err && err.message ? err.message : String(err)))
    return 1
  }

  if (!existsSync(args.exe)) {
    console.error('[smoke] 找不到打包产物：' + args.exe)
    console.error('[smoke] 先用 pnpm build:desktop 打出 release/win-unpacked/，')
    console.error('[smoke] 或用 --exe=<path> 指到一个已经打好的 pinfolio.exe。')
    return 1
  }
  say('exe: ' + args.exe)

  // ---- 临时现场：userData 与 data 全在临时目录里，跑完删 ----
  const tmpRoot = mkdtempSync(join(tempBase(), 'pinfolio-desktop-smoke-'))
  const userDataDir = join(tmpRoot, 'userdata')
  const dataDir = join(userDataDir, 'data')
  const logFile = join(userDataDir, 'logs', 'main.log')
  mkdirSync(userDataDir, { recursive: true })
  say('临时 userData: ' + userDataDir)

  // 用户的真实桌面端数据：跑前跑后必须一模一样（不存在的话跑完也不许被造出来）
  const appDataPinfolio = process.env.APPDATA ? join(process.env.APPDATA, 'pinfolio') : null
  const appDataBefore = appDataPinfolio ? dirStats(appDataPinfolio) : null
  if (appDataPinfolio) {
    say('用户真实数据 ' + appDataPinfolio + ': ' + (appDataBefore ? appDataBefore.files + ' 文件 / ' + appDataBefore.bytes + ' 字节' : '不存在'))
  }
  // 仓库根目录里不许冒出 %SystemDrive% 这种垃圾目录（SystemDrive 缺了才会出现）
  const junkInRoot = join(ROOT, '%SystemDrive%')
  const junkInRootBefore = existsSync(junkInRoot)

  // ---- 子进程 env：删 ELECTRON_RUN_AS_NODE、补 SystemDrive、数据目录指到临时目录 ----
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  env.SystemDrive = 'C:'
  env.PINBOARD_DATA = dataDir
  // 某些自动化环境（CI / 沙箱）启动时 env 近乎空的，Chromium 没这几个会起不来：
  // 缺 SystemRoot 连 DLL 都找不着，缺 TEMP 缓存目录落不了地。
  if (!env.SystemRoot) env.SystemRoot = 'C:\\Windows'
  if (!env.windir) env.windir = env.SystemRoot
  if (!env.TEMP) env.TEMP = tempBase()
  if (!env.TMP) env.TMP = env.TEMP

  const cdpPort = await freePort()
  const child = spawn(
    args.exe,
    ['--user-data-dir=' + userDataDir, '--remote-debugging-port=' + cdpPort],
    // 打包态 GUI 进程没有 stdout，这两条 pipe 是给开发态（打包外的 exe）留的回退路径
    { cwd: tmpRoot, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  )
  say('pid: ' + child.pid + ' / CDP 端口: ' + cdpPort)

  const childOut = { text: '' }
  child.stdout?.on('data', (b) => {
    childOut.text += b.toString('utf8')
  })
  child.stderr?.on('data', (b) => {
    childOut.text += b.toString('utf8')
  })
  let spawnError = null
  child.once('error', (err) => {
    spawnError = err
  })
  let exited = false
  child.once('exit', () => {
    exited = true
  })

  let stopped = false
  let browser = null
  let baseUrl = null
  let port = 0

  const stopChild = async () => {
    if (stopped) return
    stopped = true
    if (child.pid === undefined) return
    await killTree(child.pid)
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline && !exited && isAlive(child.pid)) await sleep(100)
  }

  try {
    // ---- 1. 从日志里拿端口 ----
    const found = await waitForBaseUrl(logFile, childOut, BOOT_TIMEOUT_MS)
    if (!found) {
      if (spawnError) fail('起不来（spawn 失败）：' + spawnError.message)
      fail(
        '等 ' + BOOT_TIMEOUT_MS + 'ms 也没在 ' + logFile + ' 里看到 listening on http://127.0.0.1:<port>' +
          '（进程' + (exited ? '已退出，退出码 ' + child.exitCode : '还活着') + '）',
      )
    }
    baseUrl = found.url
    port = Number(new URL(baseUrl).port)
    say('从' + found.source + '拿到地址: ' + baseUrl)

    // ---- 2. /api/health 200 ----
    const health = await waitForHealth(baseUrl, HEALTH_TIMEOUT_MS)
    say('GET /api/health -> 200 ' + JSON.stringify(health))

    // ---- 3. 连 CDP，断言这是便签页 ----
    const opened = await openWindowPage(cdpPort, baseUrl, CDP_TIMEOUT_MS)
    browser = opened.browser
    const page = opened.page
    say('CDP 页面: ' + page.url())

    const title = await page.title()
    if (!title.toLowerCase().includes('pinfolio')) fail('页面标题不含 pinfolio：' + JSON.stringify(title))
    say('标题: ' + JSON.stringify(title))

    const pathName = new URL(page.url()).pathname
    if (pathName === '/login' || pathName === '/setup') {
      fail('窗口停在 ' + pathName + '（桌面端应当免密直接进便签页）：' + page.url())
    }
    say('路径: ' + pathName + '（不是 /login，也不是 /setup）')

    // 便签页的硬标记：.page.page-notes + 顶部输入框。停在加载动画 / 登录页都过不了这两条。
    await page
      .waitForSelector('.page.page-notes', { timeout: PAGE_TIMEOUT_MS })
      .catch(() => fail('等 ' + PAGE_TIMEOUT_MS + 'ms 也没等到便签页外壳 .page-notes（当前 ' + page.url() + '）'))
    await page
      .waitForSelector('.composer textarea', { timeout: PAGE_TIMEOUT_MS })
      .catch(() => fail('便签页里没有输入框 .composer textarea（页面渲染不完整？）'))
    say('便签页已渲染：.page-notes + .composer textarea 都在')

    // ---- 4. 数据库真的可写：在渲染进程里 POST 一条便签（带 cookie）拿 201 ----
    const marker = 'desktop smoke ' + new Date().toISOString().replace('T', ' ').slice(0, 19)
    const created = await page.evaluate(async ({ base, content }) => {
      const res = await fetch(base + '/api/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      return { status: res.status, body: (await res.text()).slice(0, 300) }
    }, { base: baseUrl, content: marker })
    if (created.status !== 201) fail('POST /api/notes 期望 201，实际 ' + created.status + '：' + created.body)
    say('POST /api/notes -> 201 ' + created.body.slice(0, 160))

    // 写完读得回来：刷新一次，这条便签要出现在列表里（只验 201 不足以证明「便签页是真的」）
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page
      .waitForSelector('.page.page-notes', { timeout: PAGE_TIMEOUT_MS })
      .catch(() => fail('刷新后便签页没回来（' + page.url() + '）'))
    await page
      .waitForFunction((m) => document.body.innerText.includes(m), marker, { timeout: PAGE_TIMEOUT_MS })
      .catch(() => fail('刷新后列表里找不到刚建的便签（' + marker + '）'))
    say('刷新后新便签已出现在列表里：' + marker)

    // ---- 5. 截图（tmp/ 不进版本库） ----
    mkdirSync(dirname(SHOT), { recursive: true })
    const shot = await page.screenshot({ path: SHOT })
    if (shot.length < SHOT_MIN_BYTES) fail('截图只有 ' + shot.length + ' 字节，像是空白页：' + SHOT)
    const textLen = await page.evaluate(() => document.body.innerText.trim().length)
    if (textLen === 0) fail('页面 body 的可见文本是空的（渲染白屏？）：' + SHOT)
    say('截图: ' + SHOT + '（' + shot.length + ' 字节，页面可见文本 ' + textLen + ' 字符）')

    // ---- 6. 收尾：关连接、杀进程、验端口释放 ----
    await browser.close().catch(() => {})
    browser = null
    await stopChild()
    if (isAlive(child.pid)) fail('taskkill 之后进程 ' + child.pid + ' 还在')
    say('进程 ' + child.pid + ' 已退出')

    const deadline = Date.now() + 10_000
    let refused = await portRefused(port)
    while (!refused && Date.now() < deadline) {
      await sleep(200)
      refused = await portRefused(port)
    }
    if (!refused) fail('进程没了但端口 ' + port + ' 还能连上（没释放？）')
    say('端口 ' + port + ' 已释放（再连被拒）')

    // ---- 7. 用户真实数据 / 仓库垃圾目录：一个都不许多 ----
    const appDataAfter = appDataPinfolio ? dirStats(appDataPinfolio) : null
    const same =
      (appDataBefore === null && appDataAfter === null) ||
      (appDataBefore !== null && appDataAfter !== null &&
        appDataBefore.files === appDataAfter.files && appDataBefore.bytes === appDataAfter.bytes)
    if (!same) {
      fail(
        '动到了用户的真实桌面端数据 ' + appDataPinfolio + '：跑前 ' +
          (appDataBefore ? appDataBefore.files + ' 文件 / ' + appDataBefore.bytes + ' 字节' : '不存在') + '，跑后 ' +
          (appDataAfter ? appDataAfter.files + ' 文件 / ' + appDataAfter.bytes + ' 字节' : '不存在'),
      )
    }
    if (appDataPinfolio) say('用户真实数据未变：' + (appDataAfter ? appDataAfter.files + ' 文件 / ' + appDataAfter.bytes + ' 字节' : '不存在（也没被造出来）'))

    if (existsSync(join(tmpRoot, '%SystemDrive%'))) fail('cwd 里生成了 %SystemDrive% 垃圾目录（SystemDrive 没补上）')
    if (!junkInRootBefore && existsSync(junkInRoot)) fail('仓库根目录里生成了 ' + junkInRoot + ' 垃圾目录')
    say('没有 %SystemDrive% 垃圾目录')

    say('冒烟通过')
    return 0
  } catch (err) {
    const tail = readTail(logFile, 40)
    console.error('[smoke] ✗ ' + (err instanceof SmokeError ? err.message : (err && err.stack) || String(err)))
    if (baseUrl) console.error('[smoke] 地址: ' + baseUrl)
    if (tail.length) {
      console.error('[smoke] ---- ' + logFile + ' 最后 ' + tail.length + ' 行 ----')
      for (const line of tail) console.error('  ' + line)
    } else if (childOut.text.trim()) {
      console.error('[smoke] ---- 子进程输出 ----')
      console.error(childOut.text.trim().split(/\r?\n/).slice(-40).join('\n'))
    } else {
      console.error('[smoke] 日志文件读不到（' + logFile + '），也没有子进程输出')
    }
    return 1
  } finally {
    if (browser) await browser.close().catch(() => {})
    await stopChild()
    if (args.keep) {
      say('--keep：保留临时目录 ' + tmpRoot)
    } else {
      const rmErr = await removeDir(tmpRoot)
      if (rmErr) console.error('[smoke] 删临时目录失败（手动清一下）：' + tmpRoot + ' ' + String(rmErr))
      else say('临时目录已删：' + tmpRoot)
    }
  }
}

process.exitCode = await main()
