import { BASE } from './env.mjs'
import { CHROME as exe } from '../tools/chrome-path.mjs'
import { login } from './login.mjs'
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

// 中英切换的端到端验收。
//
// 两个方向都要测：界面上点「English」→ 侧栏/占位符/标题变英文、<html lang> 跟着变、刷新后还记得；
// 再点回「中文」→ 全变回来。另外单独验服务端的 Accept-Language（同一句错误文案跟着请求头变语言）。
//
// 注意：这个用例**不能**用 login() 的默认行为（它会 addInitScript 把 pinboard-locale 钉成 zh，
// 每次导航都会重写 localStorage，切到英文后一刷新就被拉回中文）。所以传 { pin: false }，
// 改成用浏览器的 locale: 'zh-CN' 让首次访问自然落在中文。
const B = BASE
const results = []
const ok = (name, cond) => results.push((cond ? 'PASS ' : 'FAIL ') + name)
const hasCJK = (s) => /[\u4e00-\u9fff]/.test(String(s))

const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1.5, locale: 'zh-CN' })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

// 侧栏按顺序是 便签/邮件/资产/观测/主机/服务/备份/设置，用下标点，别依赖文案（否则本用例自己就语言相关了）
const nav = (i) => page.locator('.nav-item').nth(i)
const lang = () => page.evaluate(() => document.documentElement.lang)
const navLabels = () => page.locator('.nav-label').allTextContents()
const saved = () => page.evaluate(() => localStorage.getItem('pinboard-locale'))
// 语言那一行的两个 chip：中文在左、English 在右
const langRow = () => page.locator('.card').filter({ has: page.locator('button.chip', { hasText: 'English' }) }).locator('.row').last()

try {
  mkdirSync('tmp', { recursive: true })
  await login(page, B, { pin: false })

  // ---- 1. 默认（浏览器 zh-CN、没存过选择）应该是中文 ----
  await page.waitForTimeout(400)
  ok('首次访问是中文（跟随浏览器 zh-CN）', (await navLabels()).includes('便签'))
  ok('html lang = zh-CN', (await lang()) === 'zh-CN')
  ok('没存过选择时不写 localStorage', (await saved()) === null)

  // ---- 2. 设置页点 English ----
  await nav(7).click()
  await page.waitForTimeout(400)
  ok('设置页中文有「外观」', (await page.locator('.section-title', { hasText: '外观' }).count()) === 1)
  await page.locator('button.chip', { hasText: 'English' }).first().click()
  await page.waitForTimeout(500)
  const enLabels = await navLabels()
  ok('切英文后侧栏变英文', enLabels.includes('Notes') && enLabels.includes('Settings') && !enLabels.includes('便签'))
  ok('切英文后 html lang = en', (await lang()) === 'en')
  ok('切英文后外观卡标题变 Appearance', (await page.locator('.section-title', { hasText: 'Appearance' }).count()) === 1)
  ok('选择写进了 localStorage', (await saved()) === 'en')
  await page.screenshot({ path: 'tmp/shot-i18n-settings-en.png' })

  // ---- 3. 刷新后还记得 ----
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  ok('刷新后仍是英文', (await navLabels()).includes('Notes'))
  ok('刷新后 html lang 仍是 en', (await lang()) === 'en')

  // ---- 4. 便签页的英文文案（占位符、按钮） ----
  await nav(0).click()
  await page.waitForTimeout(600)
  const ph = await page.getAttribute('.composer textarea', 'placeholder')
  ok('便签输入框占位符是英文：' + ph, !!ph && !hasCJK(ph))
  const topTitle = await page.locator('.topbar-title, .page-title, h1').first().textContent().catch(() => '')
  ok('顶栏标题是英文：' + topTitle, !!topTitle && !hasCJK(topTitle))
  await page.screenshot({ path: 'tmp/shot-i18n-notes-en.png' })

  // ---- 5. 服务端也跟着 Accept-Language 走 ----
  const call = (al) => page.evaluate(async (v) => {
    const r = await fetch('/api/notes/999999', { headers: { 'Accept-Language': v } })
    return { status: r.status, body: await r.json() }
  }, al)
  const zhErr = await call('zh-CN,zh;q=0.9')
  const enErr = await call('en-US,en;q=0.9')
  ok('中文请求头拿到中文错误：' + zhErr.body.error, zhErr.status === 404 && hasCJK(zhErr.body.error))
  ok('英文请求头拿到英文错误：' + enErr.body.error, enErr.status === 404 && !hasCJK(enErr.body.error))

  // ---- 6. 点回中文 ----
  await nav(7).click()
  await page.waitForTimeout(400)
  await langRow().locator('button.chip').first().click()
  await page.waitForTimeout(500)
  ok('切回中文后侧栏是中文', (await navLabels()).includes('便签'))
  ok('切回中文后 html lang = zh-CN', (await lang()) === 'zh-CN')
  ok('切回中文后 localStorage = zh', (await saved()) === 'zh')
  await page.screenshot({ path: 'tmp/shot-i18n-settings-zh.png' })
} catch (e) {
  results.push('FAIL 脚本异常: ' + e.message)
} finally {
  console.log(results.join('\n'))
  console.log('ERRORS:', errors.length ? JSON.stringify(errors) : 'none')
  await browser.close()
  const failed = results.filter((r) => r.startsWith('FAIL')).length
  if (failed) process.exitCode = 1
}
