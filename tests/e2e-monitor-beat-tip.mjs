import { CHROME as exe } from '../tools/chrome-path.mjs';
import { login } from './login.mjs'
// 观测台心跳色条「悬停看这一拍」的端到端验收：时间 / 状态 / 响应 / 消息 + 提示框不被裁
// 运行（在项目根目录）：node tests\e2e-monitor-beat-tip.mjs
import { chromium } from 'playwright-core'

const BASE = 'http://127.0.0.1:7788'
const VW = 1440
const VH = 950

const fails = []
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg) }

// ---------- API 层：每拍都带时间 / 消息 / 响应 ----------
const res = await fetch(BASE + '/api/monitors?fresh=1')
ok(res.ok, 'GET /api/monitors -> 200（实际 ' + res.status + '）')
const data = await res.json()
const all = (data.groups || []).flatMap((g) => g.monitors)
ok(all.length > 0, '观测项非空（' + all.length + ' 条）')

const shapeOk = all.every((m) => Array.isArray(m.beatTimes) && Array.isArray(m.beatMsgs) && Array.isArray(m.beatPings)
  && m.beatTimes.length === m.beats.length
  && m.beatMsgs.length === m.beats.length
  && m.beatPings.length === m.beats.length)
ok(shapeOk, '每条的 beatTimes / beatMsgs / beatPings 都与 beats 等长')
ok(all.every((m) => m.beatTimes.every((t) => t === null || !Number.isNaN(Date.parse(t)))), 'beatTimes 都是可解析的 ISO 或 null')
ok(all.every((m) => m.beatMsgs.every((s) => typeof s === 'string' && s === s.trim())), 'beatMsgs 都是去掉首尾空白的字符串')
ok(all.every((m) => m.beatTimes.length === 0 || m.beatTimes[m.beatTimes.length - 1] === m.time),
  '最后一拍的时间 = 卡片「检查」那一行的时间（两边不能打架）')

const withBeats = all.filter((m) => m.beats.length >= 3)
ok(withBeats.length > 0, '有至少 3 拍的观测项（' + withBeats.length + ' 条）')
const target = withBeats.find((m) => (m.beatMsgs[m.beatMsgs.length - 1] || '').length > 0) || withBeats[0]
if (!target) { console.log('\n没有可测的观测项'); process.exit(1) }
const n = target.beats.length
console.log('[info] 目标观测项 #' + target.id + ' ' + target.name + '，' + n + ' 拍')

// 和后端 beat.ts 的 toIso 同口径：ISO → 本地 `MM-DD HH:mm:ss`（format.ts 的 stamp，同年省年份）
const pad = (v) => (v < 10 ? '0' + v : String(v))
const stampOf = (iso) => {
  const d = new Date(iso)
  const now = new Date()
  const date = (d.getFullYear() === now.getFullYear() ? '' : d.getFullYear() + '-') + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  return date + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
}

// ---------- 浏览器侧 ----------
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1.5, locale: 'zh-CN' })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

await login(page)
await page.goto(BASE + '/monitors', { waitUntil: 'networkidle' })
await page.waitForSelector('.monitor-card')
await page.waitForTimeout(400)

const card = page.locator('#monitor-' + target.id)
ok(await card.count() === 1, '页面上找到目标卡片 #monitor-' + target.id)
await card.scrollIntoViewIfNeeded()
await page.waitForTimeout(150)

const strip = card.locator('.monitor-beats')
const box = await strip.boundingBox()
ok(!!box && box.width > 0 && box.height > 0, '色条有可悬停的区域')
ok(await strip.locator('i').count() === n, '色条段数 = 心跳数（' + n + '）')
ok(await strip.getAttribute('title') === null, '有逐拍详情后不再挂整条的原生 title（避免两个提示框打架）')

const tip = page.locator('.beat-tip')
const cells = strip.locator('i')
const boxesOf = async () => { const out = []; for (let i = 0; i < n; i++) out.push(await cells.nth(i).boundingBox()); return out }
// 先把鼠标挪到角落、等动画回位，再按「这一段自己现在的盒子」去点：
// 悬停会让那一段变宽、把邻居挤走，用悬停前算好的坐标去点会点到别人身上
const park = async () => { await page.mouse.move(4, 4); await page.waitForTimeout(280) }
const hoverCell = async (i) => { const b = await cells.nth(i).boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2) }

// —— 悬停的那一段要稍微变大、把左右邻居挤开 ——
await park()
const w0 = await boxesOf()
await hoverCell(3)
await page.waitForTimeout(280)
const w1 = await boxesOf()
ok(w1[3].width > w0[3].width * 1.5, '悬停的那一段变宽了（' + w0[3].width.toFixed(1) + ' → ' + w1[3].width.toFixed(1) + 'px）')
ok(w1[3].height > w0[3].height + 0.5, '悬停的那一段也变高了一点（' + w0[3].height.toFixed(1) + ' → ' + w1[3].height.toFixed(1) + 'px）')
ok(w1[3].x < w0[3].x, '这一段的左边界往左撑开（' + w0[3].x.toFixed(1) + ' → ' + w1[3].x.toFixed(1) + 'px）')
ok(w1[2].x + w1[2].width < w0[2].x + w0[2].width, '左边的邻居被挤开了一点（右边界 ' + (w0[2].x + w0[2].width).toFixed(1) + ' → ' + (w1[2].x + w1[2].width).toFixed(1) + 'px）')
ok(w1[4].x > w0[4].x + 0.5, '右边的邻居被挤开了（左边界 ' + w0[4].x.toFixed(1) + ' → ' + w1[4].x.toFixed(1) + 'px）')
await park()
const w2 = await boxesOf()
ok(Math.abs(w2[3].width - w0[3].width) < 0.8 && Math.abs(w2[4].x - w0[4].x) < 0.8, '鼠标移开后色条恢复原样（不留下变形）')

// —— 最后一拍：时间 / 状态 / 响应 / 消息 ——
await hoverCell(n - 1)
await page.waitForTimeout(150)
ok(await tip.count() === 1, '悬停色条弹出 1 个提示框')
let text = (await tip.innerText()).replace(/\s+/g, ' ')
ok(text.includes(stampOf(target.beatTimes[n - 1])), '提示框含这一拍的时间：' + stampOf(target.beatTimes[n - 1]))
if (target.beatMsgs[n - 1]) ok(text.includes(target.beatMsgs[n - 1]), '提示框含这一拍的消息：' + JSON.stringify(target.beatMsgs[n - 1]))
if (typeof target.beatPings[n - 1] === 'number') ok(text.includes(target.beatPings[n - 1] + ' ms'), '提示框含这一拍的响应：' + target.beatPings[n - 1] + ' ms')
ok(text.includes('第 ' + n + '/' + n + ' 拍'), '提示框标明是第几拍')

const tb = await tip.boundingBox()
ok(!!tb && tb.x >= 0 && tb.y >= 0 && tb.x + tb.width <= VW + 0.5 && tb.y + tb.height <= VH + 0.5,
  '提示框完整落在视口内（不越界不被裁）：' + JSON.stringify(tb && { x: Math.round(tb.x), y: Math.round(tb.y), w: Math.round(tb.width), h: Math.round(tb.height) }))
ok(await tip.evaluate((el) => getComputedStyle(el).pointerEvents) === 'none', '提示框不吃鼠标事件（pointer-events: none，不会挡住点卡片）')

// —— 往左挪几拍：内容跟着换 ——
const i2 = Math.max(0, n - 6)
await park()
await hoverCell(i2)
await page.waitForTimeout(150)
text = (await tip.innerText()).replace(/\s+/g, ' ')
ok(text.includes('第 ' + (i2 + 1) + '/' + n + ' 拍'), '悬停另一拍时提示框跟着换成第 ' + (i2 + 1) + ' 拍')
ok(text.includes(stampOf(target.beatTimes[i2])), '换拍后时间也跟着换：' + stampOf(target.beatTimes[i2]))
if (target.beatMsgs[i2]) ok(text.includes(target.beatMsgs[i2]), '换拍后消息也跟着换：' + JSON.stringify(target.beatMsgs[i2]))

await page.screenshot({ path: 'tmp/shot-beat-tip.png', clip: { x: 0, y: 0, width: VW, height: Math.min(VH, box.y + 120) } })

// —— 移开就收起 ——
await page.mouse.move(VW / 2, 4)
await page.waitForTimeout(200)
ok(await tip.count() === 0, '鼠标移开后提示框消失')

// —— 顶部一行也要能看全（.content 是滚动容器，坑 11）——
const firstCard = page.locator('.monitor-card').first()
const fcells = firstCard.locator('.monitor-beats i')
const fb = await fcells.nth(Math.floor((await fcells.count()) / 2)).boundingBox()
await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2)
await page.waitForTimeout(150)
const ftb = await tip.boundingBox()
ok(await tip.count() === 1 && !!ftb && ftb.y >= 0 && ftb.y + ftb.height <= VH, '第一行卡片（贴着页头）的提示框也在视口内')

// —— 抽屉里的色条同一套逻辑 ——
await page.mouse.move(VW / 2, 4)
await page.waitForTimeout(120)
await firstCard.locator('.asset-icon').click()
await page.waitForTimeout(600)
// 抽屉要等详情接口回来才有色条，别拿固定 sleep 赌
let drawerOk = true
try { await page.waitForSelector('.drawer .monitor-beats', { timeout: 15000 }) } catch { drawerOk = false }
ok(drawerOk, '抽屉里有色条')
const dstrip = page.locator('.drawer .monitor-beats').first()
const dcells = dstrip.locator('i')
const dn = await dcells.count()
const db = await dcells.nth(Math.ceil(dn / 2) - 1).boundingBox()
await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2)
await page.waitForTimeout(200)
ok(await tip.count() === 1, '抽屉里的色条悬停也弹提示框')
const dtext = (await tip.innerText()).replace(/\s+/g, ' ')
ok(dtext.includes('第 ' + Math.ceil(dn / 2) + '/' + dn + ' 拍'), '抽屉提示框标明第几拍（' + dn + ' 拍里的中间那拍）')
await page.screenshot({ path: 'tmp/shot-beat-tip-drawer.png' })

ok(errors.length === 0, '无 console 报错' + (errors.length ? '：' + errors.join(' | ') : ''))
await browser.close()

console.log('\n' + (fails.length === 0 ? 'ALL PASS' : 'FAILED ' + fails.length + '：\n- ' + fails.join('\n- ')))
process.exit(fails.length === 0 ? 0 : 1)
