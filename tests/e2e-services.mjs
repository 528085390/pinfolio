import { BASE } from './env.mjs'
import { CHROME as exe } from '../tools/chrome-path.mjs'
import { login } from './login.mjs'
import { chromium } from 'playwright-core'

// 服务页 e2e（重写版，对应「一张卡一个服务 + 头顶服务器标签当筛选」的新界面）。
//
// 断言分三类：
//   1. 形态：一卡一服务、筛选条一台机一颗、卡里是按「端口 + 启动方式」合并的部署行；
//      并且**明确没有**观测页那套心跳条 / 状态药丸，也没有旧的双视角、双密度 tab。
//   2. 交互：点服务器标签压暗别的卡、点卡头标签、搜索、点卡名开服务抽屉、点部署行开部署抽屉。
//   3. 写入：勾 / 取消自启动要真落盘（改完读回 /api/services 核对，再改回去）；
//      有部署挂着的服务不许删（列阻塞项 + 输入框和删除键都禁用）；没有部署的服务能删（手输 id 确认）。
//
// 写在隔离实例里跑（node tests/run.mjs --only=services），不许打真实的 7788。

const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: 'zh-CN' })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('dialog', (d) => d.accept())

let failed = 0
const ok = (name, cond, extra) => {
  if (!cond) failed += 1
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || !extra ? '' : '  → ' + extra))
}
const text = (loc) => loc.innerText().then((s) => s.replace(/\s+/g, ' ').trim())

/** 读服务清单（带会话 cookie，等价于页面自己拉的那份） */
const apiData = () => page.evaluate(() => fetch('/api/services').then((r) => r.json()))
/** 按服务名定位那张卡（卡名是 .svc-card-name，别被摘要里的同名文字带偏） */
const cardOf = (name) => page.locator('.svc-card').filter({ has: page.locator('.svc-card-name', { hasText: name }) })

try {
  await login(page)
  await page.goto(BASE + '/services', { waitUntil: 'networkidle' })
  await page.waitForSelector('.svc-card', { timeout: 20000 })

  const d0 = await apiData()
  const nSvc = d0.services.length
  const nDep = d0.deploys.length
  const nSrv = d0.servers.length
  const nameOfServer = (id) => (d0.servers.find((s) => s.id === id) || {}).name || id
  const nameOfService = (id) => (d0.services.find((s) => s.id === id) || {}).name || id
  console.log('[e2e] 台账基线：' + nSvc + ' 个服务 / ' + nDep + ' 条部署 / ' + nSrv + ' 台服务器')

  // ---------- 1. 形态 ----------
  ok('服务页正常渲染', await page.locator('.page-svc').count() > 0)
  const cards = await page.locator('.asset-grid.svc-grid .svc-card').count()
  ok('一张卡一个服务（卡片数 = services 数）', cards === nSvc, '卡片 ' + cards + ' / services ' + nSvc)

  ok('卡片与网格走共享紧凑刻度（跟观测台同一份定义）',
    await page.locator('.asset-grid.svc-grid.is-compact').count() === 1 &&
    await page.locator('.asset-card.svc-card.is-compact').count() === nSvc)
  ok('卡身复用通用键值行（.asset-meta-row）', await page.locator('.svc-card .asset-meta').count() > 0)

  const countText = await text(page.locator('.svc-filter-count'))
  ok('头顶计数和台账对得上', countText.includes(nSvc + ' 个服务') && countText.includes(nDep + ' 条部署') && countText.includes(nSrv + ' 台服务器'), countText)

  const chips = page.locator('.filters .chip')
  ok('筛选条是「全部」+ 每台机一颗', await chips.count() === nSrv + 1, 'chips ' + await chips.count() + ' / servers ' + nSrv)
  ok('默认停在「全部」', /全部/.test(await text(chips.first())) && (await chips.first().getAttribute('class') || '').includes('active'))

  // 观测条 / 状态药丸不该出现在这一页（这一页不探测任何东西）
  ok('没有心跳条（BeatStrip）', await page.locator('.beat-strip, .beat-row').count() === 0)
  ok('没有状态药丸（status-pill）', await page.locator('.status-pill').count() === 0)
  // 旧的双视角 / 双密度 tab 已经拆掉
  ok('没有旧的双视角 / 双密度 tab', await page.locator('.svc-tabs').count() === 0)

  const depCards = d0.services.filter((v) => d0.deploys.some((d) => d.service === v.id))
  const firstDepSvc = depCards[0]
  const depCard = cardOf(firstDepSvc.name)
  ok('有部署的卡渲染出部署行', await depCard.locator('.asset-meta .asset-meta-row').count() > 0)
  ok('部署行带机器名 / 运行方式', (await text(depCard.locator('.asset-meta .asset-meta-row').first())).length > 0, await text(depCard.locator('.asset-meta .asset-meta-row').first()))
  const noDep = d0.services.find((v) => !d0.deploys.some((d) => d.service === v.id))
  if (noDep) ok('没部署的服务显示空提示', (await text(cardOf(noDep.name).locator('.svc-dep-empty'))).includes('还没登记部署'))

  // ---------- 2. 交互：头顶筛选 ----------
  const targetServer = d0.servers.find((s) => d0.deploys.some((d) => d.server === s.id))
  const onTarget = d0.services.filter((v) => d0.deploys.some((d) => d.server === targetServer.id && d.service === v.id)).length
  const srvChip = page.locator('.filters .chip').filter({ hasText: targetServer.name })
  await srvChip.click()
  await page.waitForTimeout(250)
  const dimCount = await page.locator('.svc-card.is-dim').count()
  ok('点「' + targetServer.name + '」：不在那台机上的卡被压暗', dimCount === nSvc - onTarget, '压暗 ' + dimCount + ' / 期望 ' + (nSvc - onTarget))
  ok('压暗不下架（卡片总数不变）', await page.locator('.svc-card').count() === nSvc)
  ok('选中的服务器标签高亮', (await srvChip.getAttribute('class') || '').includes('active'))
  await srvChip.click()
  await page.waitForTimeout(250)
  ok('再点一下回到全部（没有压暗的卡）', await page.locator('.svc-card.is-dim').count() === 0)

  // ---------- 3. 交互：卡头服务器标签也能筛 ----------
  await depCard.locator('.svc-srv .monitor-chip').first().click()
  await page.waitForTimeout(250)
  ok('卡头服务器标签点了也能筛', await page.locator('.svc-card.is-dim').count() > 0)
  await chips.first().click()
  await page.waitForTimeout(250)
  ok('回「全部」清掉压暗', await page.locator('.svc-card.is-dim').count() === 0)

  // ---------- 4. 交互：搜索 ----------
  const q = page.locator('.filters .input.input-sm')
  await q.fill(firstDepSvc.name)
  await page.waitForTimeout(300)
  const searched = await page.locator('.svc-card').count()
  ok('搜索收敛到匹配的卡', searched >= 1 && searched < nSvc, '搜「' + firstDepSvc.name + '」→ ' + searched + ' 张')
  await q.fill('zzz-没有这个服务-e2e')
  await page.waitForTimeout(300)
  ok('搜不到时给空态', (await text(page.locator('.page-svc'))).includes('没有匹配的服务'))
  await q.fill('')
  await page.waitForTimeout(300)
  ok('清空搜索恢复全部', await page.locator('.svc-card').count() === nSvc)

  // ---------- 5. 点卡名 → 服务抽屉 ----------
  await cardOf(firstDepSvc.name).locator('.svc-card-name').click()
  await page.waitForSelector('.drawer', { timeout: 8000 })
  ok('点卡名打开服务抽屉', await page.locator('.drawer').count() === 1)
  ok('抽屉里装的就是这个服务', await page.locator('.drawer input.input').first().inputValue() === firstDepSvc.id,
    await page.locator('.drawer input.input').first().inputValue())
  await page.locator('.drawer button', { hasText: '关闭' }).click()
  await page.waitForTimeout(400)
  ok('关掉抽屉', await page.locator('.drawer').count() === 0)

  // ---------- 6. 写入：点部署行 → 部署抽屉 → 勾自启动落盘 ----------
  const oneDep = d0.services.find((v) => d0.deploys.filter((x) => x.service === v.id).length === 1)
  const dep = d0.deploys.find((x) => x.service === oneDep.id)
  const before = dep.autostart === true
  const depCard2 = cardOf(oneDep.name)
  await depCard2.locator('.svc-dep-srv-btn').first().click()
  await page.waitForSelector('.drawer', { timeout: 8000 })
  ok('点部署行打开部署抽屉', (await text(page.locator('.drawer .drawer-head'))).includes(nameOfServer(dep.server)))
  const cb = page.locator('.drawer input[type="checkbox"]').first()
  ok('部署抽屉里有自启动勾选框', await cb.count() > 0)
  ok('勾选框反映当前登记值', await cb.isChecked() === before, '库里 autostart=' + before)
  if (before) await cb.uncheck(); else await cb.check()
  await page.locator('.drawer button', { hasText: '保存' }).click()
  await page.waitForTimeout(800)
  const d1 = await apiData()
  const saved = d1.deploys.find((x) => x.server === dep.server && x.service === dep.service)
  ok('勾 / 取消自启动真的落盘了', saved && (saved.autostart === true) === !before, '回读 autostart=' + String(saved && saved.autostart))
  ok('保存后抽屉自己关了', await page.locator('.drawer').count() === 0)
  // 改回去，别把隔离实例的数据带歪
  await cardOf(oneDep.name).locator('.svc-dep-srv-btn').first().click()
  await page.waitForSelector('.drawer', { timeout: 8000 })
  if (before) await page.locator('.drawer input[type="checkbox"]').first().check()
  else await page.locator('.drawer input[type="checkbox"]').first().uncheck()
  await page.locator('.drawer button', { hasText: '保存' }).click()
  await page.waitForTimeout(800)
  const d2 = await apiData()
  const back = d2.deploys.find((x) => x.server === dep.server && x.service === dep.service)
  ok('复原成原来的登记值', (back.autostart === true) === before, '回读 autostart=' + String(back && back.autostart))

  // ---------- 7. 删除护栏：有部署挂着的服务不许删 ----------
  await cardOf(oneDep.name).locator('.svc-op[title="删这个服务"]').click()
  await page.waitForSelector('.modal', { timeout: 8000 })
  ok('有部署时删除框列出阻塞项', await page.locator('.modal .svc-del-list li').count() > 0,
    '阻塞项 ' + await page.locator('.modal .svc-del-list li').count())
  ok('有阻塞项时确认输入框禁用', await page.locator('.modal input.input').first().isDisabled())
  ok('有阻塞项时删除按钮禁用', await page.locator('.modal-foot button', { hasText: '删除' }).isDisabled())
  await page.locator('.modal-foot button', { hasText: '取消' }).click()
  await page.waitForTimeout(400)
  ok('取消后卡片还在', await cardOf(oneDep.name).count() === 1)

  // ---------- 8. 新建一个空服务 → 手输 id 删掉 ----------
  const tmpId = 'e2e-tmp-svc'
  const created = await page.evaluate(async (id) => {
    const r = await fetch('/api/services/catalog', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, name: 'e2e 临时服务', kind: 'service', summary: '测试用，跑完就删' }),
    })
    return r.status
  }, tmpId)
  ok('接口能新建服务', created === 200 || created === 201, 'HTTP ' + created)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.svc-card', { timeout: 15000 })
  ok('新服务出现在页面上', await cardOf('e2e 临时服务').count() === 1)
  await cardOf('e2e 临时服务').locator('.svc-op[title="删这个服务"]').click()
  await page.waitForSelector('.modal', { timeout: 8000 })
  ok('没有部署时不列阻塞项', await page.locator('.modal .svc-del-list li').count() === 0)
  const delBtn = page.locator('.modal-foot button', { hasText: '删除' })
  ok('没输确认时删除键禁用', await delBtn.isDisabled())
  await page.locator('.modal input.input').first().fill(tmpId)
  await page.waitForTimeout(200)
  ok('输对 id 后删除键可用', !(await delBtn.isDisabled()))
  await delBtn.click()
  await page.waitForTimeout(900)
  ok('删掉后卡片消失', await cardOf('e2e 临时服务').count() === 0)
  const d3 = await apiData()
  ok('删掉后台账里也没有了', !d3.services.some((v) => v.id === tmpId))
  ok('服务数回到基线', await page.locator('.svc-card').count() === nSvc, '卡片 ' + await page.locator('.svc-card').count() + ' / 基线 ' + nSvc)

  await page.screenshot({ path: 'E:/bqj/scratch/services-page.png' })
} catch (err) {
  failed += 1
  console.error('Test error:', err)
} finally {
  ok('页面没有 console / pageerror', errors.length === 0, JSON.stringify(errors).slice(0, 400))
  console.log(errors.length ? 'ERRORS: ' + JSON.stringify(errors, null, 1) : 'ERRORS: none')
  await browser.close()
  if (failed) {
    console.log('[e2e-services] ' + failed + ' 条失败')
    process.exit(1)
  }
  console.log('[e2e-services] 全绿')
}
