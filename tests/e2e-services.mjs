import { BASE } from './env.mjs'
import { CHROME as exe } from '../tools/chrome-path.mjs'
import { login } from './login.mjs'
import { chromium } from 'playwright-core'

const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: 'zh-CN' })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('dialog', (d) => d.accept())

const ok = (name, cond, extra) => console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || !extra ? '' : '  → ' + extra))

try {
  await login(page)
  await page.goto(BASE + '/services', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)

  // 1. 服务页正常渲染
  const onServices = await page.locator('.page-svc').count() > 0
  ok('服务页正常渲染', onServices)

  // 2. 紧凑视图下渲染出多个自启动小标签
  const miniTagCount = await page.locator('.svc-autostart-tag').count()
  ok('紧凑视图渲染出自启动小标签', miniTagCount >= 30, 'got ' + miniTagCount)
  await page.screenshot({ path: 'E:/bqj/scratch/services-mini.png' })

  // 3. 切换到「详细」视图
  await page.locator('.svc-tabs.is-density button', { hasText: '详细' }).click()
  await page.waitForTimeout(400)
  const detailTagCount = await page.locator('.svc-autostart-tag').count()
  ok('详细视图渲染出自启动小标签', detailTagCount >= 30, 'got ' + detailTagCount)
  await page.screenshot({ path: 'E:/bqj/scratch/services-detail.png' })

  // 4. 验证 local 服务器卡片中：WorkBuddy 网关 API 有自启标签，易广金没有
  const localCard = page.locator('#svc-card-srv-local')
  const wbapiRow = localCard.locator('.svc-row', { hasText: 'WorkBuddy 网关 API' }).first()
  const ybRow = localCard.locator('.svc-row', { hasText: '易广金' }).first()

  const wbapiHasTag = await wbapiRow.locator('.svc-autostart-tag').count() > 0
  const ybHasTag = await ybRow.locator('.svc-autostart-tag').count() > 0
  ok('wbapi 显示自启动标签', wbapiHasTag)
  ok('yb 初始不显示自启动标签', !ybHasTag)

  // 5. 点击 yb 行的编辑按钮打开 DeployDrawer
  await ybRow.locator('button[title="改这条部署"]').click()
  await page.waitForTimeout(400)
  const drawer = page.locator('.drawer')
  ok('抽屉正常打开', await drawer.count() > 0)

  // 查找抽屉里的自启动勾选框
  const autostartCheckbox = drawer.locator('input[type="checkbox"]').first()
  ok('自启动勾选框存在', await autostartCheckbox.count() > 0)
  ok('初始状态未勾选', !(await autostartCheckbox.isChecked()))
  await page.screenshot({ path: 'E:/bqj/scratch/services-drawer.png' })

  // 6. 勾选自启动并保存
  await autostartCheckbox.check()
  ok('成功勾选自启动', await autostartCheckbox.isChecked())

  await drawer.locator('button', { hasText: '保存' }).click()
  await page.waitForTimeout(600)

  // 7. 验证保存后 yb 行出现自启动标签
  const ybHasTagAfter = await ybRow.locator('.svc-autostart-tag').count() > 0
  ok('保存后 yb 显示自启动标签', ybHasTagAfter)

  // 8. 再次打开编辑抽屉，取消勾选并保存，验证恢复
  await ybRow.locator('button[title="改这条部署"]').click()
  await page.waitForTimeout(400)
  await autostartCheckbox.uncheck()
  ok('成功取消勾选', !(await autostartCheckbox.isChecked()))

  await drawer.locator('button', { hasText: '保存' }).click()
  await page.waitForTimeout(600)

  const ybHasTagRevert = await ybRow.locator('.svc-autostart-tag').count() > 0
  ok('取消勾选保存后 yb 移除自启动标签', !ybHasTagRevert)

  // 9. 切换到「服务视角」
  await page.locator('.svc-tabs:not(.is-density) button', { hasText: '服务视角' }).click()
  await page.waitForTimeout(400)
  const serviceViewTags = await page.locator('.svc-autostart-tag').count()
  ok('服务视角渲染出自启动小标签', serviceViewTags >= 30, 'got ' + serviceViewTags)
  await page.screenshot({ path: 'E:/bqj/scratch/services-service-view.png' })

} catch (err) {
  console.error('Test error:', err)
} finally {
  console.log('ERRORS:', errors.length ? JSON.stringify(errors, null, 1) : 'none')
  await browser.close()
}
