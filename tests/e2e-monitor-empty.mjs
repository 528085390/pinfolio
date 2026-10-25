// 没有 Kuma 时，观测页要给引导卡，不是报错、也不是空白。
// CI 里没有 Kuma，这条守住「没接 Kuma 也能用其余六页」这个承诺。
// 自己起一个全新数据目录的实例（不碰真实库、也不碰 runner 那个隔离实例），
// 断言：/api/monitors/meta → configured=false；/monitors 渲染引导卡三步；不渲染观测台。
import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { CHROME as exe } from '../tools/chrome-path.mjs'
import { login } from './login.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PASSWORD = 'e2e-password'
const results = []
const ok = (name, cond, extra) => results.push((cond ? 'PASS ' : 'FAIL ') + name + (cond || !extra ? '' : '  → ' + extra))

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
    return readFileSync(file, 'utf8').trimEnd().split('\n').slice(-15).join('\n')
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

const dataDir = join(tmpdir(), 'pinfolio-e2e-empty-' + Date.now())
mkdirSync(dataDir, { recursive: true })
const port = await freePort()
const logPath = join(dataDir, 'server.log')
const fd = openSync(logPath, 'a')
// KUMA_SLUG 故意指向一个不存在的状态页：本机就算跑着 Kuma，这里也必须判定「没接上」。
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PINBOARD_DATA: dataDir,
    PORT: String(port),
    HOST: '127.0.0.1',
    PINBOARD_PASSWORD: PASSWORD,
    PINBOARD_TOKEN: '',
    KUMA_URL: '',
    KUMA_PASS: '',
    KUMA_SLUG: 'no-such-slug-e2e',
    BACKUP: '0',
    TRUST_PROXY: '',
    E2E_BASE: '',
    MAIL_E2E_BASE: '',
  },
  stdio: ['ignore', fd, fd],
  windowsHide: true,
})
closeSync(fd)
const base = 'http://127.0.0.1:' + port

let browser = null
try {
  await waitHealth(base, child, logPath)

  browser = await chromium.launch({ executablePath: exe })
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

  await login(page, base)
  // 用页面自己的 fetch 拿（带登录 cookie），免得另配 token
  const meta = await page.evaluate(async () => (await fetch('/api/monitors/meta')).json())
  ok('meta.configured = false', meta.configured === false, JSON.stringify(meta))
  ok('meta.flavor = upstream', meta.flavor === 'upstream', String(meta.flavor))

  await page.goto(base + '/monitors', { waitUntil: 'networkidle' })
  await page.waitForSelector('.kuma-guide', { timeout: 20000 })
  ok('观测页渲染引导卡', (await page.locator('.kuma-guide').count()) === 1)
  ok('标题说明还没接上', (await page.locator('.kuma-guide-title').innerText()).includes('还没接上'))
  ok('三步说明都在', (await page.locator('.kuma-guide-step-title').count()) === 3)
  ok('没有渲染观测台', (await page.locator('.stat-label').count()) === 0)
  ok('页面标题仍是观测', (await page.title()).includes('观测'), await page.title())
  ok('侧栏仍可点（其余六页不受影响）', (await page.locator('.nav-item').count()) >= 6)
  ok('无 console / page 错误', errors.length === 0, errors.join(' | '))
} catch (e) {
  results.push('FAIL 整体异常: ' + e.message)
} finally {
  if (browser) await browser.close()
  if (child.exitCode === null) {
    child.kill()
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 5000)
      child.once('exit', () => { clearTimeout(t); resolve() })
    })
  }
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  } catch (e) {
    console.warn('临时目录没删干净：' + dataDir + '（' + e.message + '）')
  }
}

console.log(results.join('\n'))
const failed = results.filter((r) => r.startsWith('FAIL')).length
console.log('\n' + (results.length - failed) + ' passed, ' + failed + ' failed, total ' + results.length)
process.exit(failed ? 1 : 0)
