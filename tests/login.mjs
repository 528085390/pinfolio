import { BASE } from './env.mjs'
// e2e 公共登录：02 鉴权之后，浏览器脚本得先过登录页，否则每个用例都卡在找不到元素。
// 密码从 PINBOARD_PASSWORD 读（别写进仓库）；同一 context 已登录时直接返回。
export const E2E_BASE = (process.env.MAIL_E2E_BASE || BASE).replace(/\/+$/, '')

export async function login(page, base = E2E_BASE) {
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  if (await page.locator('.nav-item').count()) return
  if (!(await page.locator('input[type=password]').count())) {
    await page.waitForSelector('.nav-item', { timeout: 20000 })
    return
  }
  const pw = process.env.PINBOARD_PASSWORD
  if (!pw) {
    throw new Error('这个实例开了登录：请设 PINBOARD_PASSWORD 后重跑（例如 PINBOARD_PASSWORD=你的密码 node tests/run.mjs）')
  }
  await page.fill('input[type=password]', pw)
  await page.click('button[type=submit]')
  await page.waitForSelector('.nav-item', { timeout: 30000 })
}
