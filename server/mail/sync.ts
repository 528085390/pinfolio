// 邮件增量同步（2026-11-12 v2）：把「点进邮件页就全量拉一遍」变成「后台增量同步 + 页面读库」。
// 每次同步只做三件便宜事：SEARCH 全部 UID、SEARCH 未读 UID、对本地库算差异；
// 只有新增的 UID 才真去 FETCH 元数据（QQ 2600 封时 SEARCH ~85 ms，FETCH 50 封 ~2 s，差别就在这里）。
// 调度：startMailSync() 每 MAIL_SYNC_MINUTES 分钟（默认 5）同步一遍所有启用账号的收件箱；
// 页面带 fresh=1 时会当场等一次（有封顶），其余情况只读库。
import { nowIso } from '../db.js'
import type { MailAccountRow } from './store.js'
import { listAccounts } from './store.js'
import { getClient, OP_TIMEOUT, withTimeout } from './pool.js'
import { FETCH_CHUNK, fetchEnvelopes, folderSnapshot, searchUids } from './client.js'
import { friendlyError, proxyOf } from './errors.js'
import * as repo from './repo.js'
import { diffUids, fetchOrder, flagChanges, type UidFlag } from './diff.js'
import { t } from '../i18n.js'

export type SyncOutcome = {
  accountId: number
  folder: string
  added: number
  removed: number
  flags: number
  total: number
  unseen: number
  done: number
  /** 还有没抓完的新信（首次全量同步被 maxNew 截住时为 true，下一轮接着抓） */
  partial: boolean
  ms: number
}

// 三路差异的纯函数在 diff.ts（不碰数据库，能单测）；这里只管调度与落库。
export { diffUids, flagChanges }
export type { UidFlag }

// 同一账号-文件夹同时只跑一次同步：页面轮询 + 后台定时器撞车时共用一个 promise，不要各拉一遍。
const inflight = new Map<string, Promise<SyncOutcome>>()

function keyOf(accountId: number, folder: string): string {
  return accountId + '\u0000' + folder
}

export function isSyncing(accountId: number, folder: string): boolean {
  return inflight.has(keyOf(accountId, folder))
}

export function anySyncing(): boolean {
  return inflight.size > 0
}

export function syncFolder(a: MailAccountRow, folder: string, opts: { maxNew?: number } = {}): Promise<SyncOutcome> {
  const k = keyOf(a.id, folder)
  const cur = inflight.get(k)
  if (cur) return cur
  const p = runSync(a, folder, opts).finally(() => { inflight.delete(k) })
  inflight.set(k, p)
  return p
}

async function runSync(a: MailAccountRow, folder: string, opts: { maxNew?: number }): Promise<SyncOutcome> {
  const started = Date.now()
  repo.markStatus(a.id, folder, 'syncing', '')
  try {
    const client = await getClient(a)
    const lock = await withTimeout(
      client.getMailboxLock(folder, { readOnly: true } as any),
      OP_TIMEOUT,
      t('打开文件夹 {name}', { name: folder }),
    )
    try {
      const snap = folderSnapshot(client)
      const prev = repo.getState(a.id, folder)
      // uidValidity 变了 = 服务器给这批邮件换了编号体系，本地行与正文全部作废重来
      const reset = !!prev && !!snap.uidValidity && !!prev.uid_validity && prev.uid_validity !== snap.uidValidity
      if (reset) {
        repo.deleteRows(a.id, folder)
        repo.deleteBodies(a.id, folder)
      }
      const local = reset ? [] : repo.uidFlags(a.id, folder)
      const remote = await searchUids(client)
      const { added, removed } = diffUids(local.map((r) => r.uid), remote.all)
      if (removed.length) repo.deleteRows(a.id, folder, removed)
      // 新信按 UID 从大到小抓：首次全量同步时先落最近的，被 maxNew 截断也能立刻看到新信
      const queue = fetchOrder(added)
      const take = opts.maxNew && opts.maxNew > 0 ? queue.slice(0, opts.maxNew) : queue
      let done = repo.countRows(a.id, folder)
      repo.setProgress(a.id, folder, done, remote.all.length)
      for (const batch of repo.chunk(take, FETCH_CHUNK)) {
        const rows = await withTimeout(fetchEnvelopes(client, a.id, folder, batch), 120_000, t('抓取邮件列表'))
        repo.insertRows(a.id, folder, rows)
        done += rows.length
        repo.setProgress(a.id, folder, done, remote.all.length)
      }
      const unseen = new Set(remote.unseen)
      const flags = flagChanges(repo.uidFlags(a.id, folder), unseen)
      if (flags.length) repo.applyFlags(a.id, folder, flags)
      const outcome: SyncOutcome = {
        accountId: a.id,
        folder,
        added: take.length,
        removed: removed.length,
        flags: flags.length,
        total: remote.all.length,
        unseen: unseen.size,
        done: repo.countRows(a.id, folder),
        partial: take.length < added.length,
        ms: Date.now() - started,
      }
      repo.saveState({
        accountId: a.id,
        folder,
        uidValidity: snap.uidValidity,
        uidNext: snap.uidNext,
        total: outcome.total,
        unseen: outcome.unseen,
        done: outcome.done,
        status: 'idle',
        error: '',
        lastSyncAt: nowIso(),
        ms: outcome.ms,
      })
      return outcome
    } finally {
      try { lock.release() } catch { /* ignore */ }
    }
  } catch (err) {
    const msg = friendlyError(err, proxyOf(a))
    repo.markStatus(a.id, folder, 'error', msg)
    throw new Error(msg)
  }
}

/** 后台同步：不 await，出错只记日志（错误本身已经写进 mail_sync_state，页面能看到） */
export function syncInBackground(a: MailAccountRow, folder: string, opts: { maxNew?: number } = {}): void {
  syncFolder(a, folder, opts).catch((err) => {
    console.warn('[mail] 同步失败 account=' + a.id + ' folder=' + folder + ' ' + (err instanceof Error ? err.message : String(err)))
  })
}

export function syncAllInBackground(folder = 'INBOX'): void {
  for (const a of listAccounts(false)) syncInBackground(a, folder)
}

/**
 * 后台定时同步。环境变量：
 *   MAIL_SYNC=0            关掉（测试隔离实例用得上）
 *   MAIL_SYNC_MINUTES=5    轮询间隔，最小 1 分钟
 *   MAIL_SYNC_START_DELAY_MS=8000  启动后多久跑第一轮（让 HTTP 先起来）
 */
// 同进程里二次 startServer()（端口被占后重试、单测起两个实例）不许挂出第二份定时器：
// 第一个实例起的定时器继续跑，后来者拿到的 stop 是空操作。和其它后台任务的重入守卫一致。
let activeStop: (() => void) | null = null

export function startMailSync(): () => void {
  if (String(process.env.MAIL_SYNC ?? '').trim() === '0') return () => {}
  if (activeStop) return () => {}
  const minutes = Math.max(1, Number(process.env.MAIL_SYNC_MINUTES || 5) || 5)
  const delay = Math.max(0, Number(process.env.MAIL_SYNC_START_DELAY_MS || 8000) || 0)
  let stopped = false
  let running = false
  const tick = async () => {
    if (stopped || running) return
    running = true
    try {
      for (const a of listAccounts(false)) {
        if (stopped) break
        try {
          await syncFolder(a, 'INBOX')
        } catch (err) {
          console.warn('[mail] 定时同步失败 account=' + a.id + ' ' + (err instanceof Error ? err.message : String(err)))
        }
      }
    } finally {
      running = false
    }
  }
  const first = setTimeout(() => { void tick() }, delay)
  const timer = setInterval(() => { void tick() }, minutes * 60_000)
  ;(first as any).unref?.()
  ;(timer as any).unref?.()
  const stop = () => {
    stopped = true
    clearTimeout(first)
    clearInterval(timer)
    if (activeStop === stop) activeStop = null
  }
  activeStop = stop
  return stop
}