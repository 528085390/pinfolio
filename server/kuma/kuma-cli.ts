import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { t } from '../i18n.js'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

// 建 / 删 Kuma 观测项只能走 kuma 仓库的 CLI：Kuma 的前端已删，改库又绕不过它的调度内存，
// 而 tools/kuma-monitor.cjs 会用 socket.io 登录后调 add / deleteMonitor（ADD-MONITOR.md 的既定路子）。
// 这里只是一层薄封装：spawn 子进程、从它打印的那行里抠出 id、超时就杀掉。
const DEFAULT_CLI = join(process.cwd(), '..', 'kuma', 'tools', 'kuma-monitor.cjs')
const RUN_TIMEOUT_MS = 60000

/** CLI 位置可用 KUMA_CLI 覆盖（pinboard 不一定和 kuma 同父目录）。 */
export function kumaCliPath(): string {
  return process.env.KUMA_CLI || DEFAULT_CLI
}

export function kumaCliReady(): boolean {
  return existsSync(kumaCliPath())
}

/**
 * 跑一次 kuma-monitor，回它的 stdout；非 0 退出把 stderr 抛上来（错误文案要能直接给用户看）。
 */
export function runKuma(args: string[], timeoutMs = RUN_TIMEOUT_MS): Promise<string> {
  const cli = kumaCliPath()
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: dirname(dirname(cli)),
      env: process.env,
      windowsHide: true,
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(t('kuma-monitor 超时（{cmd}）', { cmd: args[0] })))
    }, timeoutMs)
    child.stdout?.on('data', (b: Buffer) => { out += b.toString('utf8') })
    child.stderr?.on('data', (b: Buffer) => { err += b.toString('utf8') })
    child.on('error', (e: Error) => {
      clearTimeout(timer)
      reject(new Error(t('跑不起来 kuma-monitor：{msg}', { msg: e.message })))
    })
    child.on('close', (code: number | null) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error((err || out || t('kuma-monitor 退出码 {code}', { code: String(code) })).trim()))
    })
  })
}

/** 「已创建组 id=9（…）」「已创建监视器 id=130（…）」里抠 id。 */
function firstId(out: string, what: 'group' | 'monitor'): number {
  const m = out.match(/id=(\d+)/)
  if (!m) {
    throw new Error(
      what === 'group'
        ? t('kuma-monitor 没回组 id：{out}', { out: out.trim() })
        : t('kuma-monitor 没回监视器 id：{out}', { out: out.trim() }),
    )
  }
  return Number(m[1])
}

/** 确保分组存在（同名幂等），回组 id。 */
export async function ensureGroup(name: string): Promise<number> {
  return firstId(await runKuma(['group-add', name]), 'group')
}

/** 建一个观测项并挂到分组；回新 id。 */
export async function addMonitor(payload: Record<string, unknown>, groupId?: number): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), 'pinboard-kuma-'))
  const file = join(dir, 'payload.json')
  try {
    writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8')
    const args = ['add', file]
    if (groupId) args.push('--group', String(groupId))
    return firstId(await runKuma(args), 'monitor')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** 回滚用：建到一半失败时把已经建出来的删掉。 */
export async function deleteMonitor(id: number): Promise<void> {
  await runKuma(['del', String(id)])
}

/** 删分组：组里还有观测项时 CLI 会拒绝，所以只能放在删完观测项之后。 */
export async function deleteGroup(id: number): Promise<void> {
  await runKuma(['group-del', String(id)], 30000)
}
