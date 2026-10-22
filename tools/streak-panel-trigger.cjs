#!/usr/bin/env node
// 每日打卡面板的「立即观测」助手：确保 127.0.0.1:8765 在跑，再触发一次「一键出发」。
// 给 Kuma #24 用，配方见 pinboard/monitor-actions.json（command 步骤）。
//
// 面板平时不常驻（手动 启动项目.bat 才起），所以这里先探活、没起就按启动脚本同样的方式
// 用 pythonw 后台拉起（detached，配方跑完不会把它带走），等就绪后再 POST /api/trigger-all。
//
// 用法：node tools/streak-panel-trigger.cjs [--no-trigger]
//   --no-trigger  只保证面板在跑，不触发批量（自检用）
// 退出码：0 成功；1 面板起不来或触发失败（stdout 最后一行就是抽屉里显示的详情）

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const PANEL_DIR = process.env.STREAK_PANEL_DIR || 'D:\\ai_project\\streak-panel'
const BASE = 'http://127.0.0.1:8765'
const noTrigger = process.argv.includes('--no-trigger')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 探活：能连上就返回状态码，连不上返回 0。 */
async function probe(url, ms = 1500) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) })
    return r.status
  } catch {
    return 0
  }
}

async function ensurePanel() {
  if (await probe(BASE + '/')) {
    console.log('面板已在运行')
    return true
  }
  const py = path.join(PANEL_DIR, '.venv', 'Scripts', 'pythonw.exe')
  const entry = path.join(PANEL_DIR, 'panel.py')
  if (!fs.existsSync(py) || !fs.existsSync(entry)) {
    console.log('找不到面板：' + PANEL_DIR + '（可用环境变量 STREAK_PANEL_DIR 指到项目根）')
    return false
  }
  const child = spawn(py, [entry], { cwd: PANEL_DIR, detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  for (let i = 0; i < 25; i++) {
    await sleep(800)
    if (await probe(BASE + '/')) {
      console.log('面板已启动（pid ' + child.pid + '）')
      return true
    }
  }
  console.log('面板 20 秒内没起来：' + PANEL_DIR + '\\panel.py')
  return false
}

async function triggerAll() {
  const res = await fetch(BASE + '/api/trigger-all', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(20000),
  })
  const text = await res.text()
  let msg = text
  try {
    const j = JSON.parse(text)
    msg = j.message || j.msg || j.error || text
  } catch {}
  console.log('HTTP ' + res.status + ' · ' + String(msg || '').slice(0, 200))
  return res.ok
}

;(async () => {
  if (!(await ensurePanel())) process.exit(1)
  if (noTrigger) {
    console.log('READY（--no-trigger，未触发）')
    return
  }
  process.exit((await triggerAll()) ? 0 : 1)
})().catch((e) => {
  console.log('失败：' + ((e && e.message) || e))
  process.exit(1)
})
