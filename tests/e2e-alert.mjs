import { CHROME as exe } from '../tools/chrome-path.mjs';
import { login } from './login.mjs'
// 观测异常通知端到端验收：右上角弹窗 / 恢复自动关闭 / 点 × 关 / 点击跳对应卡片
// 用 page.route 伪造 /api/monitors，不真弄坏 Kuma；用 page.clock 快进 30 秒轮询。
// 运行：
//   cd <项目目录>
//   $env:PINBOARD_DATA="$PWD\tmp\e2e-data"; $env:PORT='7799'; $env:KUMA_BASE='http://127.0.0.1:9'; pnpm start
//   node tests\e2e-alert.mjs
import { chromium } from 'playwright-core'

const BASE = process.env.ALERT_E2E_BASE || 'http://127.0.0.1:7799'
const POLL = 30000
const VIEW = { width: 1440, height: 900 }

const fails = []
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg) }

const GRP = 'my-server (阿里云)'   // 真实数据里组名带地区后缀
const SHORT = 'my-server'          // 而 monitor 名前缀用的是去掉后缀的短名
let seq = 1
const mk = (name, status, extra = {}) => ({
  id: seq++, name: SHORT + ' / ' + name, type: 'http', group: GRP, status,
  time: new Date().toISOString(), ping: status === 1 ? 42 : null,
  msg: status === 1 ? '200 - OK' : 'connect ECONNREFUSED 203.0.113.2:80',
  description: '', showMsg: false, active: true, interval: 60,
  uptime24: status === 1 ? 1 : 0.5, beats: [1, 1, 1, status === 1 ? 1 : 0],
  beatTones: [null, null, null, null], downCount: status === 1 ? 0 : 1,
  lastDown: null, link: null, ...extra,
})
const payload = (monitors, extra = {}) => {
  const down = monitors.filter((m) => m.status === 0).length
  const pending = monitors.filter((m) => m.status === 2).length
  return {
    kuma: { base: 'http://127.0.0.1:3001', slug: 'obs', title: '观测' },
    updatedAt: new Date().toISOString(),
    summary: { total: monitors.length, up: monitors.length - down - pending, down, pending, uptime24: 0.99 },
    groups: [{ id: 1, name: GRP, monitors }],
    ...extra,
  }
}

// 6 个固定观测项（id 稳定，便于断言）
const NAMES = ['app-api', 'app-manager', 'nginx', '公网入口', '号池看门狗', 'xray']
const allUp = () => NAMES.map((n) => mk(n, 1))
const withDown = (names) => NAMES.map((n) => mk(n, names.includes(n) ? 0 : 1))

const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: VIEW, locale: 'zh-CN', deviceScaleFactor: 1 })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

let current = payload(allUp())
await page.route('**/api/monitors*', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) }))

await page.clock.install()
const loaded = async () => {
  await page.waitForSelector('.sidebar')
  await page.waitForTimeout(350)   // 让首轮轮询真的跑完（真实网络）
}
const reloadWith = async (p) => {
  current = p
  await page.reload({ waitUntil: 'domcontentloaded' })
  await loaded()
}
// 快进一整轮 30 秒轮询（多轮就多快进几次）
const advance = async (rounds = 1) => {
  for (let i = 0; i < rounds; i++) {
    await page.clock.fastForward(POLL + 500)
    await page.waitForTimeout(250)
  }
}
const alertCount = () => page.locator('.alert-item').count()

await login(page)
await page.goto(BASE + '/notes', { waitUntil: 'domcontentloaded' })
await loaded()

// ---------- A 基线 / 弹出 / 不自动关 / 恢复自动关 ----------
ok(await page.locator('.alert-stack').count() === 0, 'A1 首轮基线（全正常）不弹通知')

current = payload(withDown(['app-api']))
await advance()
await page.waitForSelector('.alert-item', { timeout: 5000 }).catch(() => {})
ok(await alertCount() === 1, 'A2 一项变红后弹出 1 条通知')
ok(await page.locator('.alert-stack').isVisible().catch(() => false), 'A3 通知容器可见')

const box = await page.locator('.alert-item').first().boundingBox()
const vp = page.viewportSize()
ok(!!box && box.x + box.width > vp.width - 40 && box.y < 40,
  'A4 通知贴在右上角（right=' + (box ? Math.round(box.x + box.width) : '?') + ' / 视口宽 ' + vp.width + '，top=' + (box ? Math.round(box.y) : '?') + '）')

const style = await page.locator('.alert-stack').evaluate((el) => {
  const cs = getComputedStyle(el)
  return { position: cs.position, zIndex: cs.zIndex }
})
ok(style.position === 'fixed', 'A5 通知容器是 position:fixed（不会被 .content 的 overflow 裁掉）')
const inView = await page.locator('.alert-item').first().evaluate((el) => {
  const r = el.getBoundingClientRect()
  return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth
})
ok(inView, 'A6 通知完整落在视口内')

const nameText = (await page.locator('.alert-item-name').first().textContent()) || ''
const subText = (await page.locator('.alert-item-sub').first().textContent()) || ''
ok(nameText.trim() === 'app-api', 'A7 通知显示短名（去掉「组名 / 」前缀）：' + JSON.stringify(nameText.trim()))
ok(subText.includes('my-server'), 'A8 通知带机器分组：' + JSON.stringify(subText.trim()))
ok(/ECONNREFUSED/.test(subText), 'A9 通知带故障信息：' + JSON.stringify(subText.trim()))

await advance(2)
ok(await alertCount() === 1, 'A10 默认不自动关闭（再过 2 轮仍在）')

current = payload(allUp())
await advance()
await page.waitForTimeout(200)
ok(await page.locator('.alert-stack').count() === 0, 'A11 下一次观测正常 → 通知自动关闭')

// ---------- B 恢复后再坏，还能弹 ----------
current = payload(withDown(['nginx']))
await advance()
await page.waitForSelector('.alert-item', { timeout: 5000 }).catch(() => {})
ok(await alertCount() === 1, 'B1 恢复后再坏，重新弹出')
ok(((await page.locator('.alert-item-name').first().textContent()) || '').trim() === 'nginx', 'B2 弹的是新故障项 nginx')

// ---------- C 点 × 关闭，恢复前不再打扰 ----------
await page.locator('.alert-item-close').first().click()
await page.waitForTimeout(150)
ok(await page.locator('.alert-stack').count() === 0, 'C1 点 × 立即关闭')
await advance(2)
ok(await page.locator('.alert-stack').count() === 0, 'C2 关掉后该项仍故障，不再反复弹')
current = payload(allUp())
await advance()
current = payload(withDown(['nginx']))
await advance()
await page.waitForSelector('.alert-item', { timeout: 5000 }).catch(() => {})
ok(await alertCount() === 1, 'C3 该项恢复过之后又坏，会重新弹')

// ---------- D 多条堆叠 + 上限 ----------
await reloadWith(payload(allUp()))
current = payload(withDown(['app-api', 'nginx']))
await advance()
await page.waitForSelector('.alert-item', { timeout: 5000 }).catch(() => {})
ok(await alertCount() === 2, 'D1 两项同时故障 → 2 条通知')
ok(await page.locator('.alert-more').count() === 0, 'D2 未超上限时没有「还有 N 条」')

await reloadWith(payload(allUp()))
current = payload(withDown(NAMES))
await advance()
await page.waitForSelector('.alert-item', { timeout: 5000 }).catch(() => {})
ok(await alertCount() === 4, 'D3 6 项同时故障只显示 4 条')
const moreText = (await page.locator('.alert-more').textContent().catch(() => '')) || ''
ok(/还有\s*2\s*条/.test(moreText), 'D4 多出来的折叠成「还有 2 条」：' + JSON.stringify(moreText.trim()))

// ---------- E 点击通知跳转到对应卡片 ----------
const firstId = await page.locator('.alert-item').first().evaluate((el) => el.dataset.monitorId)
await page.locator('.alert-item').first().click()
await page.waitForTimeout(300)
ok(new URL(page.url()).pathname === '/monitors', 'E1 点击通知切到观测页：' + new URL(page.url()).pathname)
await page.waitForSelector('.monitor-card.flash', { timeout: 5000 }).catch(() => {})
ok(await page.locator('.monitor-card.flash').count() === 1, 'E2 对应卡片高亮闪烁')
const flashId = await page.locator('.monitor-card.flash').first().evaluate((el) => el.id)
ok(flashId === 'monitor-' + firstId, 'E3 高亮的是被点击那一项（' + flashId + ' vs monitor-' + firstId + '）')
ok(await page.locator('.alert-item[data-monitor-id="' + firstId + '"]').count() === 0, 'E5 点过的通知同时关掉（其余仍在）')
ok(await alertCount() > 0, 'E6 其它异常的通知没被一起关掉')

// ---------- E4 列表长时滚动到卡片 ----------
const many = Array.from({ length: 16 }, (_, i) => mk('机器' + (i + 1), 1))
const lastMany = many[15]
await reloadWith(payload(many))
current = payload(many.map((m) => (m.id === lastMany.id ? { ...m, status: 0, ping: null, msg: 'timeout' } : m)))
await advance()
await page.waitForSelector('.alert-item', { timeout: 5000 }).catch(() => {})
await page.locator('.alert-item').first().click()
await page.waitForSelector('.monitor-card.flash', { timeout: 5000 }).catch(() => {})
const flashBox = await page.locator('.monitor-card.flash').first().boundingBox().catch(() => null)
ok(!!flashBox && flashBox.y >= 0 && flashBox.y + flashBox.height <= VIEW.height,
  'E4 长列表里把卡片滚进了视口（y=' + (flashBox ? Math.round(flashBox.y) : '?') + '）')

// ---------- F stale（Kuma 挂了沿用旧值）不弹也不关 ----------
await reloadWith(payload(allUp()))
current = payload(withDown(['app-api']))
await advance()
await page.waitForSelector('.alert-item', { timeout: 5000 }).catch(() => {})
ok(await alertCount() === 1, 'F1 先造出一条通知')
current = { ...payload(allUp()), stale: true, error: 'Kuma 超时，沿用旧值' }
await advance(2)
ok(await alertCount() === 1, 'F2 响应 stale 时不据此关闭通知')
current = payload(allUp())
await advance()
ok(await page.locator('.alert-stack').count() === 0, 'F3 数据恢复可信后正常关闭')

// ---------- G 暂停 / 待定 / 维护 / 黄 / 灰 都不弹 ----------
await reloadWith(payload(allUp()))
current = payload([
  mk('暂停项', 0, { active: false }),
  mk('待定项', 2),
  mk('维护项', 3),
  mk('黄灯项', 1, { msg: '[黄] 部分成功 1/3' }),
  mk('灰灯项', 1, { msg: '[灰] 未运行' }),
  mk('红灯项', 1, { msg: '[红] 失败 0/3' }),
])
await advance()
await page.waitForSelector('.alert-item', { timeout: 5000 }).catch(() => {})
ok(await alertCount() === 1, 'G1 只有 [红] 那一项弹（暂停/待定/维护/黄/灰都不弹）')
ok(((await page.locator('.alert-item-name').first().textContent()) || '').trim() === '红灯项', 'G2 弹出的正是 [红] 项')

// ---------- H 收尾 ----------
ok(errors.length === 0, 'H1 无 console / pageerror：' + (errors.slice(0, 3).join(' | ') || 'clean'))

await browser.close()
console.log('\n' + (fails.length === 0 ? 'ALL PASSED' : fails.length + ' FAILED:\n- ' + fails.join('\n- ')))
process.exit(fails.length === 0 ? 0 : 1)
