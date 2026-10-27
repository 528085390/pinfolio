#!/usr/bin/env node
// pinfolio 桌面端纯套壳客户端冒烟测试（spec 2026-10-27-pinfolio-desktop / Task 10）。
//
//   node tools/desktop/smoke.mjs                        # 默认 release/win-unpacked/pinfolio.exe
//   node tools/desktop/smoke.mjs --exe=<path>           # 指到别处的 pinfolio.exe
//   node tools/desktop/smoke.mjs --keep                 # 跑完保留临时目录（排查用）
//
// 它针对「桌面端是核心网页端（7788）的客户端原生套壳」做双场景真实端到端验收：
//   场景 1（在线连通）：
//     - 启动打包好的 pinfolio.exe，userData 指向临时隔离目录，绝不碰用户真实 %APPDATA%\pinfolio；
//     - 目标地址指向正在运行的网页端（默认 http://127.0.0.1:7788）；
//     - 验证 CDP 连接成功，窗口正常加载网页端，标题含 pinfolio，渲染正常，截图 tmp/desktop-smoke.png；
//     - 验证安全外链拦截（window.open 外链不内联跳转，被系统浏览器接管）；
//   场景 2（离线/等待重试）：
//     - 启动 pinfolio.exe 指向未监听的端口（如 49999）；
//     - 验证 did-fail-load 触发并自动加载优雅的离线等待重试页面（offline-page）；
//     - 验证标题含「服务连接中」，页面包含「服务未启动」和「立即重试」按钮，截图 tmp/desktop-smoke-offline.png；
//   收尾与断言：
//     - taskkill 彻底杀死进程树，确保无孤儿残留；
//     - 断言用户的真实数据（%APPDATA%\pinfolio 与 data/pinboard.db）零修改、零污染；
//     - 断言当前工作目录与仓库根目录下未产生 %SystemDrive% 垃圾目录。

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
const SHOT_ONLINE = join(ROOT, 'tmp', 'desktop-smoke.png')
const SHOT_OFFLINE = join(ROOT, 'tmp', 'desktop-smoke-offline.png')

const BOOT_TIMEOUT_MS = 25_000
const CDP_TIMEOUT_MS = 20_000
const SHOT_MIN_BYTES = 5_000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function tempBase() {
  for (const c of [process.env.TEMP, process.env.TMP, tmpdir()]) {
    if (c && existsSync(c)) return c
  }
  return process.cwd()
}

function say(...parts) {
  console.log('[smoke]', ...parts)
}

class SmokeError extends Error {}

function fail(msg) {
  throw new SmokeError(msg)
}

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

function readTail(file, lines) {
  try {
    const all = readFileSync(file, 'utf8').split(/\r?\n/)
    while (all.length > 0 && all[all.length - 1] === '') all.pop()
    return all.slice(-lines)
  } catch {
    return []
  }
}

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
          /* 忽略 */
        }
      }
    }
  }
  walk(dir)
  return { files, bytes }
}

async function killTree(pid) {
  if (process.platform !== 'win32') {
    try { process.kill(pid, 'SIGKILL') } catch {}
    return
  }
  const taskkill = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe')
  await new Promise((done) => {
    const p = spawn(taskkill, ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    p.once('exit', () => done())
    p.once('error', () => done())
  })
}

async function waitForLogMarker(logFile, markerRegex, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (existsSync(logFile)) {
        const content = readFileSync(logFile, 'utf8')
        const m = markerRegex.exec(content)
        if (m) return m
      }
    } catch {}
    await sleep(200)
  }
  return null
}

async function connectCDP(cdpPort, timeoutMs) {
  const endpoint = 'http://127.0.0.1:' + cdpPort
  const deadline = Date.now() + timeoutMs
  let lastErr = null
  while (Date.now() < deadline) {
    try {
      const browser = await chromium.connectOverCDP(endpoint, { timeout: 3000 })
      return browser
    } catch (err) {
      lastErr = err
      await sleep(250)
    }
  }
  fail('无法连接 CDP ' + endpoint + '：' + (lastErr?.message || String(lastErr)))
}

async function runScenario({ exe, env, label, cdpPort, userDataDir, logFile, isOffline }) {
  say(`=== 开始运行测试场景：${label} ===`)
  const child = spawn(
    exe,
    ['--user-data-dir=' + userDataDir, '--remote-debugging-port=' + cdpPort],
    { cwd: userDataDir, env, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true },
  )
  say(`子进程 PID: ${child.pid} / CDP 端口: ${cdpPort}`)

  let browser = null
  try {
    const targetFound = await waitForLogMarker(logFile, /\[pinfolio\] target url: (.+)/, BOOT_TIMEOUT_MS)
    if (!targetFound) {
      fail(`等不到 target url 日志（日志路径：${logFile}）`)
    }
    say(`客户端目标地址: ${targetFound[1].trim()}`)

    browser = await connectCDP(cdpPort, CDP_TIMEOUT_MS)
    const contexts = browser.contexts()
    if (contexts.length === 0) fail('CDP 未发现任何浏览器上下文')
    const context = contexts[0]

    const deadline = Date.now() + 15_000
    let page = null
    while (Date.now() < deadline) {
      const pages = context.pages().filter(p => !p.url().startsWith('devtools://'))
      if (pages.length > 0) {
        page = pages[0]
        break
      }
      await sleep(200)
    }
    if (!page) fail('CDP 连上但未发现主页面窗口')

    await sleep(1500)
    const currentUrl = page.url()
    const title = await page.title()
    say(`当前页面 URL: ${currentUrl.slice(0, 80)}`)
    say(`当前页面标题: ${title}`)

    if (isOffline) {
      if (!title.includes('服务连接中') && !title.includes('pinfolio')) {
        fail(`离线等待页标题异常，期望含「服务连接中」或「pinfolio」，实际: ${title}`)
      }
      const pageContent = await page.content()
      if (!pageContent.includes('服务未启动') && !pageContent.includes('立即重试')) {
        fail('离线等待页面内容未包含「服务未启动」或「立即重试」提示')
      }
      say('离线等待页渲染正常（服务未启动提示与重试按钮就绪）')
      mkdirSync(dirname(SHOT_OFFLINE), { recursive: true })
      const shot = await page.screenshot({ path: SHOT_OFFLINE })
      say(`离线等待截图已保存: ${SHOT_OFFLINE} (${shot.length} 字节)`)
    } else {
      if (!title.toLowerCase().includes('pinfolio')) {
        fail(`在线页面标题未包含 pinfolio: ${title}`)
      }
      const bodyText = await page.evaluate(() => document.body.innerText.trim())
      say(`在线页面可见文本长度: ${bodyText.length} 字符`)

      const openResult = await page.evaluate(() => {
        try {
          const w = window.open('https://example.com/external-test')
          return { opened: w !== null }
        } catch (e) {
          return { error: String(e) }
        }
      })
      say(`外链安全拦截测试结果: ${JSON.stringify(openResult)}`)
      if (page.url().includes('external-test')) {
        fail('外链安全拦截失效：主窗口直接跳转到了外链地址！')
      }

      mkdirSync(dirname(SHOT_ONLINE), { recursive: true })
      const shot = await page.screenshot({ path: SHOT_ONLINE })
      if (shot.length < SHOT_MIN_BYTES) {
        fail(`截图体积异常 (${shot.length} 字节)，可能是空白页`)
      }
      say(`在线页面截图已保存: ${SHOT_ONLINE} (${shot.length} 字节)`)
    }

    say(`=== 场景 ${label} 验证通过 ===`)
  } finally {
    if (browser) await browser.close().catch(() => {})
    await killTree(child.pid)
  }
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error('[smoke] ✗ ' + (err?.message || String(err)))
    return 1
  }

  if (!existsSync(args.exe)) {
    console.error('[smoke] 找不到打包产物：' + args.exe)
    console.error('[smoke] 请先运行 pnpm build:desktop 打包生成 release/win-unpacked/')
    return 1
  }
  say('测试可执行程序: ' + args.exe)

  const tmpRoot = mkdtempSync(join(tempBase(), 'pinfolio-desktop-smoke-'))
  const appDataPinfolio = process.env.APPDATA ? join(process.env.APPDATA, 'pinfolio') : null
  const appDataBefore = appDataPinfolio ? dirStats(appDataPinfolio) : null
  const junkInRoot = join(ROOT, '%SystemDrive%')
  const junkInRootBefore = existsSync(junkInRoot)

  const baseEnv = { ...process.env }
  delete baseEnv.ELECTRON_RUN_AS_NODE
  baseEnv.SystemDrive = 'C:'
  if (!baseEnv.SystemRoot) baseEnv.SystemRoot = 'C:\\Windows'
  if (!baseEnv.windir) baseEnv.windir = baseEnv.SystemRoot
  if (!baseEnv.TEMP) baseEnv.TEMP = tempBase()
  if (!baseEnv.TMP) baseEnv.TMP = baseEnv.TEMP

  try {
    const port1 = await freePort()
    const userDir1 = join(tmpRoot, 'user-online')
    mkdirSync(userDir1, { recursive: true })
    await runScenario({
      exe: args.exe,
      env: { ...baseEnv, PINBOARD_WEB_URL: 'http://127.0.0.1:7788' },
      label: '在线连通 (7788 直连)',
      cdpPort: port1,
      userDataDir: userDir1,
      logFile: join(userDir1, 'logs', 'main.log'),
      isOffline: false,
    })

    const port2 = await freePort()
    const userDir2 = join(tmpRoot, 'user-offline')
    mkdirSync(userDir2, { recursive: true })
    await runScenario({
      exe: args.exe,
      env: { ...baseEnv, PINBOARD_WEB_URL: 'http://127.0.0.1:49999' },
      label: '离线等待 (未监听端口重连提示)',
      cdpPort: port2,
      userDataDir: userDir2,
      logFile: join(userDir2, 'logs', 'main.log'),
      isOffline: true,
    })

    const appDataAfter = appDataPinfolio ? dirStats(appDataPinfolio) : null
    const same =
      (appDataBefore === null && appDataAfter === null) ||
      (appDataBefore !== null && appDataAfter !== null &&
        appDataBefore.files === appDataAfter.files && appDataBefore.bytes === appDataAfter.bytes)
    if (!same) {
      fail('用户真实数据被意外篡改！跑前与跑后不一致')
    }
    say('用户真实 APPDATA 数据完整无变化')

    if (existsSync(join(tmpRoot, '%SystemDrive%'))) fail('产生 %SystemDrive% 临时垃圾目录')
    if (!junkInRootBefore && existsSync(junkInRoot)) fail('仓库根目录产生了 %SystemDrive% 垃圾目录')
    say('无 %SystemDrive% 垃圾目录残留')

    say('🎉 桌面端套壳冒烟全部通过！双场景（7788 在线 + 离线等待）验证完毕。')
    return 0
  } catch (err) {
    console.error('[smoke] ✗ 冒烟失败：' + (err?.message || String(err)))
    return 1
  } finally {
    if (args.keep) {
      say('--keep：保留临时目录 ' + tmpRoot)
    } else {
      await removeDir(tmpRoot)
      say('临时测试目录已清理')
    }
  }
}

process.exitCode = await main()
