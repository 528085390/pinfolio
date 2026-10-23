import { BASE } from './env.mjs'
import { CHROME as exe } from '../tools/chrome-path.mjs';
import { login } from './login.mjs'
import { chromium } from 'playwright-core'
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
const B = BASE
const results = []
const ok = (name, cond, extra) => results.push((cond ? 'PASS ' : 'FAIL ') + name + (cond || !extra ? '' : '  → ' + extra))

// ---- 先摸一遍 API，拿到一个真实观测项 ----
const payload = await (await fetch(B + '/api/monitors')).json()
const all = (payload.groups || []).flatMap((g) => g.monitors)
const target = all[0]
if (!target) {
  console.log('FAIL 列表里一个观测项都没有')
  process.exit(1)
}

// ---- 列表必须带 active / interval（抽屉与「已暂停」标记要用） ----
ok('列表项带 active 字段', typeof target.active === 'boolean', JSON.stringify(target.active))
ok('列表项带 interval 字段', typeof target.interval === 'number', JSON.stringify(target.interval))

// ---- 详情接口：字段齐全且不含敏感字段 ----
let detail = null
let detailText = ''
let detailStatus = 0
try {
  const detailRes = await fetch(B + '/api/monitors/' + target.id)
  detailStatus = detailRes.status
  detailText = await detailRes.text()
  try { detail = JSON.parse(detailText) } catch { detail = null }
} catch (e) {
  results.push('FAIL 详情接口请求失败: ' + e.message)
}
ok('GET /api/monitors/:id 返回 200 JSON', detailStatus === 200 && detail !== null, detailStatus + ' ' + detailText.slice(0, 60))
ok('详情含 monitor.name', detail?.monitor?.name === target.name, JSON.stringify(detail?.monitor?.name))
ok('详情含 latest / beats / action', !!detail && 'latest' in detail && Array.isArray(detail.beats) && !!detail.action, detail ? Object.keys(detail).join(',') : 'null')
const SECRETS = ['sshPrivateKey', 'sshPassword', 'sshPassphrase', 'basic_auth_pass', 'basic_auth_user', 'bearer_token',
  'oauth_client_secret', 'mqttPassword', 'radiusSecret', 'kafkaProducerSaslOptions', 'databaseConnectionString', 'tlsKey', 'grpcMetadata', 'pushToken']
const leaked = SECRETS.filter((k) => detailText.includes(k))
ok('详情不含任何敏感字段名', leaked.length === 0, leaked.join(','))
ok('详情不含 ssh 私钥内容', !detailText.includes('PRIVATE KEY'))

// ---- 浏览器侧 ----
const browser = await chromium.launch({ executablePath: exe })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1.5, locale: 'zh-CN' })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('dialog', (d) => d.accept())

try {
  await login(page)
  await page.goto(B + '/monitors', { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  ok('观测页渲染出卡片', (await page.locator('.monitor-card').count()) > 0, String(await page.locator('.monitor-card').count()))

  // 点卡片（点图标区域，避开标题链接）
  await page.locator('.monitor-card').first().locator('.asset-icon').click()
  await page.waitForTimeout(600)
  const drawer = page.locator('.drawer')
  ok('点卡片弹出抽屉', (await drawer.count()) === 1, String(await drawer.count()))
  ok('抽屉标题是「观测项详情」', (await drawer.locator('.drawer-head').innerText()).includes('观测项'), await drawer.locator('.drawer-head').innerText())

  const nameInput = drawer.locator('input[name="name"]')
  // 抽屉正文要等详情接口回来才渲染，固定 600ms 偶尔不够（详情要问 Kuma，慢起来 1s+）——先等它出现
  await nameInput.first().waitFor({ timeout: 8000 }).catch(() => {})
  ok('抽屉里有名称输入框', (await nameInput.count()) === 1)
  ok('名称输入框带出当前名字', (await nameInput.inputValue()) === target.name, await nameInput.inputValue())
  ok('抽屉里有介绍输入框', (await drawer.locator('textarea[name="description"]').count()) === 1)
  ok('抽屉里有频率输入框', (await drawer.locator('input[name="interval"]').count()) === 1)
  ok('抽屉里有本次观测区块', (await drawer.locator('.monitor-drawer-now').count()) === 1)
  ok('抽屉里有心跳条', (await drawer.locator('.monitor-beats').count()) === 1)
  ok('抽屉里有立即观测按钮', (await drawer.locator('button', { hasText: '立即观测' }).count()) >= 1)

  // Esc 关闭
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  ok('Esc 关闭抽屉', (await page.locator('.drawer').count()) === 0)

  // 遮罩关闭
  await page.locator('.monitor-card').first().locator('.asset-icon').click()
  await page.waitForTimeout(500)
  await page.locator('.overlay').click({ position: { x: 30, y: 300 } })
  await page.waitForTimeout(300)
  ok('点遮罩关闭抽屉', (await page.locator('.drawer').count()) === 0)

  // 表格视图行点击
  await page.locator('button[title="表格视图"]').click()
  await page.waitForTimeout(400)
  await page.locator('table.data tbody tr').first().click()
  await page.waitForTimeout(600)
  ok('表格行点击也能开抽屉', (await page.locator('.drawer').count()) === 1)
  await page.keyboard.press('Escape')

  ok('无 console / page 错误', errors.length === 0, errors.join(' | '))
} catch (e) {
  results.push('FAIL 整体异常: ' + e.message)
} finally {
  await browser.close()
}

// ================= 阶段 2：写能力（改名 / 频率 / 暂停恢复 / 删除） =================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const KUMA_DIR = 'E:\\bqj\\kuma'
const SNAPSHOT = path.join(KUMA_DIR, 'SNAPSHOT.md')
const BACKUPS = path.join(KUMA_DIR, 'backups')
const TMPDIR = path.join('E:\\bqj\\pinboard', 'tmp')
const ID = target.id
const ORIG_NAME = target.name
const ORIG_INTERVAL = target.interval

async function jcall(method, p, body, contentType) {
  const init = { method }
  if (body !== undefined) {
    init.headers = { 'Content-Type': contentType || 'application/json' }
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
  }
  const res = await fetch(B + '/api' + p, init)
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch {}
  return { status: res.status, data, text }
}
function cli(args) {
  const r = spawnSync(process.execPath, [path.join(KUMA_DIR, 'tools', 'kuma-monitor.cjs'), ...args], { cwd: KUMA_DIR, encoding: 'utf8' })
  return { code: r.status, out: ((r.stdout || '') + (r.stderr || '')).trim() }
}
const findByName = (pl, name) => (pl?.groups || []).flatMap((g) => g.monitors).find((m) => m.name === name) || null
function payloadFile(name, tag, active = false) {
  const p = path.join(TMPDIR, 'e2e-payload-' + tag + '-' + Date.now() + '.json')
  writeFileSync(p, JSON.stringify({
    type: 'http', name, url: BASE + '/api/stats', interval: 60, retryInterval: 60,
    maxretries: 0, timeout: 20, active, upsideDown: false, accepted_statuscodes: ['200-299'], ignoreTls: false,
  }, null, 2))
  return p
}

// ---- 改名 ----
const snapBefore = statSync(SNAPSHOT).mtimeMs
const rn = await jcall('PATCH', '/monitors/' + ID, { name: ORIG_NAME + ' ·e2e' })
ok('PATCH 改名返回 200', rn.status === 200, rn.status + ' ' + rn.text.slice(0, 100))
const dAfter = await jcall('GET', '/monitors/' + ID)
ok('改名后详情读回新名字', dAfter.data?.monitor?.name === ORIG_NAME + ' ·e2e', JSON.stringify(dAfter.data?.monitor?.name))
await sleep(2600)
ok('改名后 kuma/SNAPSHOT.md 被重生成', statSync(SNAPSHOT).mtimeMs > snapBefore, snapBefore + ' -> ' + statSync(SNAPSHOT).mtimeMs)
const listAfter = await jcall('GET', '/monitors?fresh=1')
ok('改名后列表显示新名字', !!findByName(listAfter.data, ORIG_NAME + ' ·e2e'), listAfter.status + ' ' + listAfter.text.slice(0, 80))
const back = await jcall('PATCH', '/monitors/' + ID, { name: ORIG_NAME })
const dBack = await jcall('GET', '/monitors/' + ID)
ok('改回原名成功', back.status === 200 && dBack.data?.monitor?.name === ORIG_NAME, back.status + ' ' + JSON.stringify(dBack.data?.monitor?.name))

// ---- 频率 ----
const iv = await jcall('PATCH', '/monitors/' + ID, { interval: 300 })
const dIv = await jcall('GET', '/monitors/' + ID)
ok('PATCH 把频率改成 300 生效', iv.status === 200 && dIv.data?.monitor?.interval === 300, iv.status + ' ' + JSON.stringify(dIv.data?.monitor?.interval))
const ivBack = await jcall('PATCH', '/monitors/' + ID, { interval: ORIG_INTERVAL })
const dIvBack = await jcall('GET', '/monitors/' + ID)
ok('频率改回原值', ivBack.status === 200 && dIvBack.data?.monitor?.interval === ORIG_INTERVAL, JSON.stringify(dIvBack.data?.monitor?.interval))

// ---- 校验 ----
const emptyName = await jcall('PATCH', '/monitors/' + ID, { name: '   ' })
ok('空名字返回 400', emptyName.status === 400, emptyName.status + ' ' + emptyName.text.slice(0, 80))
const smallIv = await jcall('PATCH', '/monitors/' + ID, { interval: 5 })
ok('interval=5 返回 400', smallIv.status === 400, smallIv.status + ' ' + smallIv.text.slice(0, 80))
const bigTimeout = await jcall('PATCH', '/monitors/' + ID, { timeout: 999 })
ok('timeout ≥ interval 返回 400', bigTimeout.status === 400, bigTimeout.status + ' ' + bigTimeout.text.slice(0, 80))
const other = all.find((m) => m.id !== ID)
const dup = await jcall('PATCH', '/monitors/' + ID, { name: other ? other.name : 'x' })
ok('改成别的观测项的名字返回 400', dup.status === 400, dup.status + ' ' + dup.text.slice(0, 80))
const csrf = await jcall('PATCH', '/monitors/' + ID, JSON.stringify({ name: 'x' }), 'text/plain')
ok('非 JSON 的写请求被拒绝（415）', csrf.status === 415, csrf.status + ' ' + csrf.text.slice(0, 80))

// ---- 暂停 / 恢复 ----
const pz = await jcall('POST', '/monitors/' + ID + '/pause', {})
ok('暂停返回 200', pz.status === 200, pz.status + ' ' + pz.text.slice(0, 80))
const dPaused = await jcall('GET', '/monitors/' + ID)
ok('暂停后 active=false', dPaused.data?.monitor?.active === false, JSON.stringify(dPaused.data?.monitor?.active))
const lPaused = await jcall('GET', '/monitors?fresh=1')
ok('列表里该项显示为已暂停', findByName(lPaused.data, ORIG_NAME)?.active === false, JSON.stringify(findByName(lPaused.data, ORIG_NAME)?.active))
const rs = await jcall('POST', '/monitors/' + ID + '/resume', {})
const dResumed = await jcall('GET', '/monitors/' + ID)
ok('恢复后 active=true', rs.status === 200 && dResumed.data?.monitor?.active === true, rs.status + ' ' + JSON.stringify(dResumed.data?.monitor?.active))

// ---- 改名保护：被策略按名字引用时拒绝改名 ----
const GROUP_ID = payload.groups[0].id
const stamp = Date.now().toString().slice(-5)
const nameA = 'e2e 临时A ' + stamp
const nameB = 'e2e 临时B ' + stamp
const created = []
try {
  const addA = cli(['add', payloadFile(nameA, 'A'), '--group', String(GROUP_ID), '--inactive'])
  const addB = cli(['add', payloadFile(nameB, 'B'), '--group', String(GROUP_ID), '--inactive'])
  ok('用 CLI 建了两个临时观测项', addA.code === 0 && addB.code === 0, addA.out + ' | ' + addB.out)
  const fresh1 = await jcall('GET', '/monitors?fresh=1')
  const mA = findByName(fresh1.data, nameA)
  const mB = findByName(fresh1.data, nameB)
  ok('临时观测项出现在列表里', !!mA && !!mB, JSON.stringify([mA?.id, mB?.id]))
  if (mA) created.push(mA.id)
  if (mB) created.push(mB.id)
  if (mA && mB) {
    const polFile = path.join(TMPDIR, 'e2e-policy-' + stamp + '.json')
    writeFileSync(polFile, JSON.stringify({ v: 1, gate: { when: { monitorStatus: { name: nameA, is: 'UP' } }, recheck: 300 }, interval: { default: 600 } }))
    const pol = cli(['policy', String(mB.id), polFile])
    ok('给临时 B 配上「按名字引用 A」的策略', pol.code === 0, pol.out)
    const blocked = await jcall('PATCH', '/monitors/' + mA.id, { name: nameA + '-改名' })
    ok('被策略按名字引用时拒绝改名', blocked.status === 409 || blocked.status === 400, blocked.status + ' ' + blocked.text.slice(0, 140))
    const stillA = await jcall('GET', '/monitors/' + mA.id)
    ok('拒绝改名后名字没变', stillA.data?.monitor?.name === nameA, JSON.stringify(stillA.data?.monitor?.name))
  }

  // ---- 删除：名字必须全等 + 删前备份 ----
  const nameC = 'e2e 待删 ' + stamp
  const addC = cli(['add', payloadFile(nameC, 'C'), '--group', String(GROUP_ID), '--inactive'])
  ok('建了一个待删除的临时观测项', addC.code === 0, addC.out)
  const fresh2 = await jcall('GET', '/monitors?fresh=1')
  const mC = findByName(fresh2.data, nameC)
  ok('待删除项出现在列表里', !!mC, JSON.stringify(mC?.id))
  if (mC) created.push(mC.id)
  if (mC) {
    const wrong = await jcall('DELETE', '/monitors/' + mC.id + '?confirm=' + encodeURIComponent('不对的名字'))
    ok('删除时名字不匹配返回 400', wrong.status === 400, wrong.status + ' ' + wrong.text.slice(0, 80))
    const stillThere = await jcall('GET', '/monitors/' + mC.id)
    ok('名字不匹配时观测项还在', stillThere.status === 200, stillThere.status)

    // UI 走一遍删除流程
    const b2 = await chromium.launch({ executablePath: exe })
    const p2 = await (await b2.newContext({ viewport: { width: 1440, height: 950 }, locale: 'zh-CN' })).newPage()
    const errs2 = []
    p2.on('pageerror', (e) => errs2.push('pageerror: ' + e.message))
    p2.on('console', (m) => { if (m.type() === 'error') errs2.push('console: ' + m.text()) })
    const countBackups = () => (existsSync(BACKUPS) ? readdirSync(BACKUPS).filter((f) => f.endsWith('.db')).length : 0)
    // 备份目录只留最近 5 份：满 5 份之后再删，数量不变，所以要看「最新一份换人了」
    const newestBackup = () => {
      if (!existsSync(BACKUPS)) return null
      const files = readdirSync(BACKUPS).filter((f) => f.endsWith('.db'))
        .map((f) => ({ f, t: statSync(path.join(BACKUPS, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t)
      return files.length ? files[0].f : null
    }
    const backupsBefore = countBackups()
    const newestBefore = newestBackup()
    try {
      await login(p2)
      await p2.goto(B + '/monitors', { waitUntil: 'networkidle' })
      await p2.waitForTimeout(700)
      const card = p2.locator('.monitor-card', { hasText: nameC }).first()
      ok('列表里能找到待删除项', (await card.count()) === 1, String(await card.count()))
      await card.locator('.asset-icon').click()
      await p2.waitForTimeout(600)
      const dw = p2.locator('.drawer')
      ok('待删除项的抽屉打开了', (await dw.count()) === 1)
      await dw.locator('button', { hasText: '删除观测' }).click()
      await p2.waitForTimeout(300)
      ok('出现删除确认面板', (await dw.locator('.monitor-drawer-confirm').count()) === 1)
      const confirmInput = dw.locator('input[name="confirmName"]')
      const dangerBtn = dw.locator('button', { hasText: '确认删除' })
      ok('确认按钮在没输名字时是禁用的', await dangerBtn.isDisabled())
      await confirmInput.fill('随便写点什么')
      await p2.waitForTimeout(150)
      ok('输错名字仍然禁用', await dangerBtn.isDisabled())
      await confirmInput.fill(nameC)
      await p2.waitForTimeout(150)
      ok('输对名字后按钮可用', !(await dangerBtn.isDisabled()))
      await dangerBtn.click()
      await p2.waitForTimeout(2500)
      ok('删除后抽屉关闭', (await p2.locator('.drawer').count()) === 0)
      ok('删除后列表里不再有它', (await p2.locator('.monitor-card', { hasText: nameC }).count()) === 0)
      const gone = await jcall('GET', '/monitors/' + mC.id)
      ok('删除后详情接口返回 404', gone.status === 404, gone.status + ' ' + gone.text.slice(0, 60))
      const backupsAfter = countBackups()
      const newestAfter = newestBackup()
      ok('删除前备份了 kuma.db', backupsAfter > backupsBefore || (backupsAfter === backupsBefore && newestAfter !== newestBefore),
        backupsBefore + ' -> ' + backupsAfter + '（最新：' + newestBefore + ' -> ' + newestAfter + '）')
      ok('删除流程无 console / page 错误', errs2.length === 0, errs2.join(' | '))
      created.splice(created.indexOf(mC.id), 1)
    } finally {
      await b2.close()
    }
  }
} catch (e) {
  results.push('FAIL 阶段2 异常: ' + e.message)
} finally {
  for (const cid of created) cli(['del', String(cid)])
}

// ---- 抽屉里改名字 / 暂停恢复（UI） ----
{
  const b3 = await chromium.launch({ executablePath: exe })
  const p3 = await (await b3.newContext({ viewport: { width: 1440, height: 950 }, locale: 'zh-CN' })).newPage()
  const errs3 = []
  p3.on('pageerror', (e) => errs3.push('pageerror: ' + e.message))
  p3.on('console', (m) => { if (m.type() === 'error') errs3.push('console: ' + m.text()) })
  try {
    await login(p3)
    await p3.goto(B + '/monitors', { waitUntil: 'networkidle' })
    await p3.waitForTimeout(700)
    const card = p3.locator('.monitor-card', { hasText: ORIG_NAME }).first()
    await card.locator('.asset-icon').click()
    await p3.waitForTimeout(600)
    const dw = p3.locator('.drawer')
    await dw.locator('input[name="name"]').fill(ORIG_NAME + ' ·ui')
    await p3.waitForTimeout(150)
    await dw.locator('button', { hasText: '保存' }).click()
    await p3.waitForTimeout(2200)
    const d3 = await jcall('GET', '/monitors/' + ID)
    ok('抽屉里改名并保存成功', d3.data?.monitor?.name === ORIG_NAME + ' ·ui', JSON.stringify(d3.data?.monitor?.name))
    ok('抽屉标题跟着变', (await dw.locator('.drawer-head').innerText()).includes(ORIG_NAME + ' ·ui'), await dw.locator('.drawer-head').innerText())

    // 暂停 → 卡片出现「已暂停」
    await dw.locator('button', { hasText: '暂停观测' }).click()
    await p3.waitForTimeout(2200)
    await p3.keyboard.press('Escape')
    await p3.waitForTimeout(400)
    const pausedCard = p3.locator('.monitor-card', { hasText: ORIG_NAME + ' ·ui' }).first()
    ok('暂停后卡片显示「已暂停」', (await pausedCard.innerText()).includes('已暂停'), (await pausedCard.innerText()).slice(0, 60))

    // 恢复
    await pausedCard.locator('.asset-icon').click()
    await p3.waitForTimeout(700)
    await p3.locator('.drawer').locator('button', { hasText: '恢复观测' }).click()
    await p3.waitForTimeout(2200)
    await p3.keyboard.press('Escape')
    await p3.waitForTimeout(400)
    const resumedCard = p3.locator('.monitor-card', { hasText: ORIG_NAME + ' ·ui' }).first()
    ok('恢复后卡片不再显示「已暂停」', !(await resumedCard.innerText()).includes('已暂停'), (await resumedCard.innerText()).slice(0, 60))
    ok('UI 写操作无 console / page 错误', errs3.length === 0, errs3.join(' | '))
  } catch (e) {
    results.push('FAIL 阶段2 UI 异常: ' + e.message)
  } finally {
    await b3.close()
    // 无论如何把名字改回去
    await jcall('PATCH', '/monitors/' + ID, { name: ORIG_NAME })
    await jcall('POST', '/monitors/' + ID + '/resume', {})
  }
}

// ================= 阶段 3：立即观测（配方 + 步骤执行器） =================
const ACTIONS = path.join('E:\\bqj\\pinboard', 'monitor-actions.json')
const actionsBackup = existsSync(ACTIONS) ? readFileSync(ACTIONS, 'utf8') : null
const stamp3 = Date.now().toString().slice(-5)
const nameD = 'e2e 立即 ' + stamp3
const created3 = []
try {
  // 立即观测要真在跑的观测项：payload 里 active 必须是 true（CLI 只会因为 --inactive 把它改成 false）
  const addD = cli(['add', payloadFile(nameD, 'D', true), '--group', String(GROUP_ID)])
  const fresh3 = await jcall('GET', '/monitors?fresh=1')
  const mD = findByName(fresh3.data, nameD)
  ok('建了一个用于立即观测的临时项', addD.code === 0 && !!mD, addD.out + ' ' + JSON.stringify(mD?.id))
  if (mD) created3.push(mD.id)

  if (mD) {
    // ---- 默认配方：让 Kuma 立刻探一次 ----
    const d0 = await jcall('GET', '/monitors/' + mD.id)
    ok('没配配方时默认是「让 Kuma 立刻探测一次」', d0.data?.action?.source === 'default' && d0.data?.action?.steps?.[0]?.type === 'kuma-check', JSON.stringify(d0.data?.action))
    ok('默认配方可以直接点（没有置灰原因）', d0.data?.action?.disabledReason === null, JSON.stringify(d0.data?.action?.disabledReason))

    const c0 = await jcall('POST', '/monitors/' + mD.id + '/check', {})
    ok('立即观测返回 200', c0.status === 200, c0.status + ' ' + c0.text.slice(0, 140))
    ok('立即观测逐步骤回显', Array.isArray(c0.data?.steps) && c0.data.steps.length === 1 && c0.data.steps[0].type === 'kuma-check', JSON.stringify(c0.data?.steps))
    ok('默认配方这一步执行成功', c0.data?.steps?.[0]?.ok === true, JSON.stringify(c0.data?.steps?.[0]))
    ok('步骤回显里带了这次探测的结果', typeof c0.data?.steps?.[0]?.detail === 'string' && c0.data.steps[0].detail.length > 0, JSON.stringify(c0.data?.steps?.[0]?.detail))
    ok('立即观测后带回了最新心跳', !!c0.data?.latest && typeof c0.data.latest.status === 'number', JSON.stringify(c0.data?.latest))

    const csrf3 = await jcall('POST', '/monitors/' + mD.id + '/check', JSON.stringify({}), 'text/plain')
    ok('立即观测也要求 JSON（415）', csrf3.status === 415, csrf3.status + ' ' + csrf3.text.slice(0, 80))

    // ---- 配了配方：http + command 两步，热读不用重启 ----
    writeFileSync(ACTIONS, JSON.stringify({
      recipes: [{
        id: mD.id,
        steps: [
          { type: 'http', url: B + '/api/health', timeout: 5 },
          { type: 'command', argv: [process.execPath, '-e', 'console.log("marker-ok")'], timeout: 15 },
        ],
      }],
    }, null, 2))
    const d1 = await jcall('GET', '/monitors/' + mD.id)
    ok('改完 monitor-actions.json 不重启就生效（热读）', d1.data?.action?.source === 'config' && d1.data?.action?.steps?.length === 2, JSON.stringify(d1.data?.action))
    const c1 = await jcall('POST', '/monitors/' + mD.id + '/check', {})
    ok('两步配方都执行成功', c1.status === 200 && c1.data?.steps?.length === 2 && c1.data.steps.every((s) => s.ok === true), c1.status + ' ' + JSON.stringify(c1.data?.steps))
    ok('http 步骤回显里带了响应状态', /HTTP 200|200/.test(String(c1.data?.steps?.[0]?.detail)), JSON.stringify(c1.data?.steps?.[0]?.detail))
    ok('command 步骤回显里带了命令输出', String(c1.data?.steps?.[1]?.detail || '').includes('marker-ok'), JSON.stringify(c1.data?.steps?.[1]?.detail))
    ok('每步都有耗时', c1.data?.steps?.every((s) => typeof s.ms === 'number' && s.ms >= 0), JSON.stringify(c1.data?.steps?.map((s) => s.ms)))

    // ---- 失败即中止：第一步失败，第二步不跑 ----
    writeFileSync(ACTIONS, JSON.stringify({
      recipes: [{
        id: mD.id,
        steps: [
          { type: 'command', argv: [process.execPath, '-e', 'process.exit(3)'], timeout: 15 },
          { type: 'command', argv: [process.execPath, '-e', 'console.log("should-not-run")'], timeout: 15 },
        ],
      }],
    }, null, 2))
    const c2 = await jcall('POST', '/monitors/' + mD.id + '/check', {})
    ok('某一步失败时整体标记失败', c2.status === 200 && c2.data?.ok === false, c2.status + ' ' + JSON.stringify(c2.data?.ok))
    ok('失败后不再执行后面的步骤', c2.data?.steps?.length === 1, JSON.stringify(c2.data?.steps?.map((s) => s.type)))
    ok('失败步骤带回了退出码', /3/.test(String(c2.data?.steps?.[0]?.detail)), JSON.stringify(c2.data?.steps?.[0]?.detail))

    // ---- 暂停的观测项不给立即观测 ----
    await jcall('POST', '/monitors/' + mD.id + '/pause', {})
    const cPaused = await jcall('POST', '/monitors/' + mD.id + '/check', {})
    ok('已暂停的观测项拒绝立即观测', cPaused.status === 400 && /暂停/.test(String(cPaused.data?.error)), cPaused.status + ' ' + cPaused.text.slice(0, 120))
    await jcall('POST', '/monitors/' + mD.id + '/resume', {})
  }

  // ---- 推送型：没有配方时按钮置灰并说明原因 ----
  const push = all.find((m) => m.type === 'push')
  if (push) {
    const dp = await jcall('GET', '/monitors/' + push.id)
    ok('推送型没配方时给置灰原因', dp.data?.action?.source === 'none' && typeof dp.data?.action?.disabledReason === 'string' && dp.data.action.disabledReason.length > 0, JSON.stringify(dp.data?.action?.disabledReason))
    const cp = await jcall('POST', '/monitors/' + push.id + '/check', {})
    ok('推送型没配方时立即观测被拒绝（400）', cp.status === 400, cp.status + ' ' + cp.text.slice(0, 120))
  }
} catch (e) {
  results.push('FAIL 阶段3 异常: ' + e.message)
} finally {
  for (const cid of created3) cli(['del', String(cid)])
  if (actionsBackup === null) { if (existsSync(ACTIONS)) unlinkSync(ACTIONS) }
  else writeFileSync(ACTIONS, actionsBackup)
}

// ---- 立即观测的 UI：点按钮 → 逐步骤回显 ----
{
  const b4 = await chromium.launch({ executablePath: exe })
  const p4 = await (await b4.newContext({ viewport: { width: 1440, height: 950 }, locale: 'zh-CN' })).newPage()
  const errs4 = []
  p4.on('pageerror', (e) => errs4.push('pageerror: ' + e.message))
  p4.on('console', (m) => { if (m.type() === 'error') errs4.push('console: ' + m.text()) })
  try {
    await login(p4)
    await p4.goto(B + '/monitors', { waitUntil: 'networkidle' })
    await p4.waitForTimeout(700)
    await p4.locator('.monitor-card', { hasText: ORIG_NAME }).first().locator('.asset-icon').click()
    await p4.waitForTimeout(700)
    const dw = p4.locator('.drawer')
    const runBtn = dw.locator('.monitor-drawer-run')
    await runBtn.first().waitFor({ timeout: 8000 }).catch(() => {})
    ok('抽屉里有「立即观测」按钮', (await runBtn.count()) === 1)
    ok('没暂停时按钮可点', !(await runBtn.isDisabled()))
    await runBtn.click()
    await p4.waitForTimeout(9000)
    ok('点完立即观测后逐步骤回显', (await dw.locator('.monitor-drawer-result').count()) >= 1, String(await dw.locator('.monitor-drawer-result').count()))
    ok('回显里标出了成功', (await dw.locator('.monitor-drawer-result.ok').count()) >= 1)
    ok('回显里写了这次探测的结果', /正常|故障|待定|维护/.test(await dw.locator('.monitor-drawer-result').first().innerText()), (await dw.locator('.monitor-drawer-result').first().innerText()).slice(0, 80))
    ok('立即观测 UI 无 console / page 错误', errs4.length === 0, errs4.join(' | '))
  } catch (e) {
    results.push('FAIL 阶段3 UI 异常: ' + e.message)
  } finally {
    await b4.close()
  }
}

console.log(results.join('\n'))
const failed = results.filter((r) => r.startsWith('FAIL')).length
console.log('\n' + (results.length - failed) + ' passed, ' + failed + ' failed, total ' + results.length)
process.exit(failed ? 1 : 0)
