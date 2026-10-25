import { BASE } from './env.mjs'
import { CHROME as exe } from '../tools/chrome-path.mjs';
import { login } from './login.mjs'
import { chromium } from 'playwright-core'
const B = BASE
const browser = await chromium.launch({ executablePath: exe })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1.5, locale: 'zh-CN' })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('dialog', (d) => d.accept())
const results = []
const ok = (name, cond, extra) => results.push((cond ? 'PASS ' : 'FAIL ') + name + (cond || !extra ? '' : '  → ' + extra))

const path = () => new URL(page.url()).pathname
const onAssets = () => page.locator('.stat-label', { hasText: '资产总数' }).count().then((n) => n > 0)
// 观测页有两副面孔：接了 Kuma 是观测台，没接是引导卡（CI 里没有 Kuma）。两者都渲染 .page-monitors。
const onMonitors = () => page.locator('.page-monitors').count().then((n) => n > 0)
const onNotes = () => page.locator('.composer').count().then((n) => n > 0)
const onSettings = () => page.locator('.section-title', { hasText: '自定义资产字段' }).count().then((n) => n > 0)
const activeNav = () => page.locator('.nav-item.active .nav-label').first().innerText().catch(() => '')

async function step(name, fn) {
  try { await fn() } catch (e) { results.push('FAIL ' + name + ' 异常: ' + e.message) }
}

async function nav(label) {
  await page.locator('.nav-item', { hasText: label }).first().click()
  await page.waitForTimeout(400)
}

try {
  // ---- 1. 根路径归一到 /notes，且仍停在便签 ----
  await login(page)
  await page.goto(B + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  ok('/ 归一成 /notes', path() === '/notes', path())
  ok('/ 落在便签页', await onNotes())
  ok('标题带页面名', (await page.title()).includes('便签'), await page.title())

  // ---- 2. 点侧栏 → URL 跟着变 ----
  await step('点资产', () => nav('资产'))
  ok('点资产后 URL=/assets', path() === '/assets', path())
  ok('点资产后渲染资产页', await onAssets())
  ok('资产页标题', (await page.title()).includes('资产'), await page.title())

  // ---- 3. 刷新后仍停在资产 ----
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  ok('刷新后 URL 仍是 /assets', path() === '/assets', path())
  ok('刷新后仍渲染资产页', await onAssets())
  ok('刷新后侧栏高亮资产', (await activeNav()) === '资产', await activeNav())

  // ---- 4. 观测页同理 ----
  await step('点观测', () => nav('观测'))
  ok('点观测后 URL=/monitors', path() === '/monitors', path())
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  ok('刷新后仍渲染观测页', await onMonitors())
  ok('刷新后侧栏高亮观测', (await activeNav()) === '观测', await activeNav())

  // ---- 5. 直接打开 /monitors（深链）----
  await login(page)
  await page.goto(B + '/monitors', { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  ok('深链 /monitors 直接进观测页', await onMonitors())
  ok('深链后侧栏高亮观测', (await activeNav()) === '观测', await activeNav())

  // ---- 6. 设置页 ----
  await step('点设置', () => nav('设置'))
  ok('点设置后 URL=/settings', path() === '/settings', path())
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  ok('刷新后仍渲染设置页', await onSettings())

  // ---- 7. 浏览器后退 ----
  await step('后退', async () => { await page.goBack(); await page.waitForTimeout(500) })
  ok('后退回到 /monitors', path() === '/monitors', path())
  ok('后退后渲染观测页', await onMonitors())

  // ---- 8. 未知路径归一到便签 ----
  await login(page)
  await page.goto(B + '/whatever-xyz', { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  ok('未知路径归一成 /notes', path() === '/notes', path())
  ok('未知路径落在便签页', await onNotes())

  // ---- 9. 便签 → 资产 → 刷新，再点便签回来 ----
  await step('回便签', () => nav('便签'))
  ok('点便签后 URL=/notes', path() === '/notes', path())
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  ok('刷新后仍在便签', await onNotes())

  ok('无 console / page 错误', errors.length === 0, errors.join(' | '))
} catch (e) {
  results.push('FAIL 整体异常: ' + e.message)
} finally {
  await browser.close()
}
console.log(results.join('\n'))
const failed = results.filter((r) => r.startsWith('FAIL')).length
console.log('\n' + (results.length - failed) + ' passed, ' + failed + ' failed, total ' + results.length)
process.exit(failed ? 1 : 0)
