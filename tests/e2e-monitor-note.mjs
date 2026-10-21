// 观测项「补充观测信息」端到端验收：A 固定说明（悬停）+ B 本次结果（卡片常显）
// 运行：cd D:\pinfolio; node tests\e2e-monitor-note.mjs
import { chromium } from 'playwright-core'

const BASE = 'http://127.0.0.1:7788'
const exe = 'C:\\Users\\you\\AppData\\Local\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe'
const TARGET_NAME = 'my-server / app-api' // 已用 kuma-monitor.cjs set 3 配上说明与 showMsg=1
const OTHER_NAME = 'oracle-proxy / xray' // 未开启 showMsg 的 SSH 项，用来验证「原样式不变」

const fails = []
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg) }

// ---------- API 层：Kuma 透传 description / showMsg ----------
const res = await fetch(BASE + '/api/monitors?fresh=1')
ok(res.ok, 'GET /api/monitors -> 200（实际 ' + res.status + '）')
const data = await res.json()
const all = (data.groups || []).flatMap((g) => g.monitors)
const target = all.find((m) => m.name === TARGET_NAME)
const other = all.find((m) => m.name === OTHER_NAME)

ok(all.length > 0, '观测项非空（' + all.length + ' 条）')
ok(all.every((m) => typeof m.description === 'string'), '每条都有 description:string')
ok(all.every((m) => typeof m.showMsg === 'boolean'), '每条都有 showMsg:boolean')
ok(!!target, '找得到目标观测项 ' + TARGET_NAME)
ok(!!other, '找得到对照观测项 ' + OTHER_NAME)

if (!target || !other) { console.log('\n无法继续 UI 断言'); process.exit(1) }

ok((target.description || '').includes('app-api'), '目标说明已写入：' + JSON.stringify(target.description))
ok(target.showMsg === true, '目标 showMsg=true')
ok((target.msg || '').length > 0, '目标有心跳消息：' + JSON.stringify(target.msg))
// 数量不写死：用户会在 Kuma 里逐个打开「补充观测信息」，硬编码 1 条早就红了（2026-10-21 已有 6 条）
const onMonitors = all.filter((m) => m.showMsg === true)
ok(onMonitors.length >= 1, '至少一条开启 showMsg（当前 ' + onMonitors.length + ' 条）')
ok(other.showMsg === false, '对照项 showMsg=false')
ok((other.msg || '').length > 0, '对照项也有心跳消息（否则测不出重复渲染）')
// 大多数观测项本来就写了 description（操作备注），所以「有说明」的卡片会带下划线钩子；
// 真正验证「没配就零变化」要看一条 description 为空的观测项。
const bare = all.find((m) => m.description === '')
ok(!!bare, '存在一条没写说明的观测项：' + (bare && bare.name))

// ---------- UI 层 ----------
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, locale: 'zh-CN' })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

await page.goto(BASE + '/monitors', { waitUntil: 'networkidle' })
await page.waitForSelector('.monitor-card')
await page.waitForTimeout(400)

// 卡片名是去掉「机器 / 」前缀后的短名；靠 名称 + 机器 两个条件定位，避免同短名撞车
const shortGroup = (n) => n.replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim() || n
const shortName = (m) => { const p = shortGroup(m.group) + ' / '; return m.name.startsWith(p) ? m.name.slice(p.length) : m.name }
const idxOf = (m) => page.locator('.monitor-card').evaluateAll((els, [name, grp]) =>
  els.findIndex((el) => el.querySelector('.asset-name')?.textContent?.trim() === name
    && el.querySelector('.monitor-machine')?.textContent?.trim() === grp), [shortName(m), shortGroup(m.group)])

const ti = await idxOf(target)
const oi = await idxOf(other)
const bi = bare ? await idxOf(bare) : -1
ok(ti >= 0, '页面上找到目标卡片（index ' + ti + '）')
ok(oi >= 0, '页面上找到对照卡片（index ' + oi + '）')
ok(bi >= 0, '页面上找到没写说明的卡片（index ' + bi + '）')

if (ti >= 0) {
  const card = page.locator('.monitor-card').nth(ti)
  ok(await card.locator('.monitor-note').count() === 1, '目标卡片有 1 行「本次观测情况」')
  const noteText = (await card.locator('.monitor-note').innerText()).replace(/\s+/g, ' ')
  ok(noteText.includes('本次观测情况') && noteText.includes(target.msg), '该行内容 = 标签 + 心跳消息：' + JSON.stringify(noteText))
  ok(await card.locator('.monitor-msg').count() === 0, '开启 showMsg 后底部小字不再重复渲染')
  const nameEl = card.locator('.asset-name')
  ok((await nameEl.getAttribute('class') || '').includes('has-note'), '卡片名带 has-note 样式钩子')
  ok(await nameEl.getAttribute('title') === target.description, '卡片名 title = 固定说明')
}

if (oi >= 0) {
  const card = page.locator('.monitor-card').nth(oi)
  ok(await card.locator('.monitor-note').count() === 0, '未开启的卡片没有那行字')
  ok(await card.locator('.monitor-msg').count() === 1, '未开启的卡片保持原来的底部小字')
}

// 全页一致性：带「本次观测情况」的卡片数 = 开启 showMsg 的观测项数
const noteCount = await page.locator('.monitor-card .monitor-note').count()
ok(noteCount === onMonitors.length, '带「本次观测情况」的卡片数 = 开启 showMsg 的观测项数（' + noteCount + '/' + onMonitors.length + '）')

if (bi >= 0) {
  const card = page.locator('.monitor-card').nth(bi)
  const nameEl = card.locator('.asset-name')
  ok(!((await nameEl.getAttribute('class')) || '').includes('has-note'), '没写说明的卡片名字没有下划线钩子')
  ok(await nameEl.getAttribute('title') === (bare.link ? bare.link.label : bare.name), '没写说明时 title 仍是原来的（链接提示或全名）')
}

ok(errors.length === 0, '无 console 报错' + (errors.length ? '：' + errors.join(' | ') : ''))
await page.screenshot({ path: 'tmp/shot-monitor-note.png', fullPage: true })
await browser.close()

console.log('\n' + (fails.length === 0 ? 'ALL PASS' : 'FAILED ' + fails.length + '：\n- ' + fails.join('\n- ')))
process.exit(fails.length === 0 ? 0 : 1)
