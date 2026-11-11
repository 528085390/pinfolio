// 邮件的本地库读写层（2026-11-12 v2 增量同步）。只在这里直接碰
// mail_messages / mail_bodies / mail_sync_state；sync.ts 与 routes.ts 都走这些函数。
// 设计口径：进页面只读库；库里的行由 sync.ts 增量补/删；正文只在用户点开时写入。
import { all, db, get, run, nowIso } from '../db.js'
import type { Addr, MailMessage, MailRow } from './types.js'

/** 库里只留 uid 与未读标记，用来算增量差异 */
export type UidFlag = { uid: number; unread: number }

export type SyncStateRow = {
  account_id: number
  folder: string
  uid_validity: string
  uid_next: number
  total: number
  unseen: number
  done: number
  status: string
  error: string
  last_sync_at: string | null
  ms: number
}

/** 批量操作时切片，避免 SQLite 的变量个数上限（默认 32766，按 500 走更稳） */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function placeholders(n: number): string {
  return new Array(n).fill('?').join(',')
}

// ---------- 列表元数据 ----------

const INSERT_MESSAGE = `INSERT INTO mail_messages
  (account_id, folder, uid, subject, from_name, from_addr, to_json, date, ts, snippet, unread, flagged, size, synced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(account_id, folder, uid) DO UPDATE SET
    subject = excluded.subject, from_name = excluded.from_name, from_addr = excluded.from_addr,
    to_json = excluded.to_json, date = excluded.date, ts = excluded.ts, snippet = excluded.snippet,
    unread = excluded.unread, flagged = excluded.flagged, size = excluded.size, synced_at = excluded.synced_at`

/** 批量写入列表行（整批一个事务，2600 封也就几十毫秒） */
export function insertRows(accountId: number, folder: string, rows: MailRow[]): number {
  if (!rows.length) return 0
  const stmt = db.prepare(INSERT_MESSAGE)
  const at = nowIso()
  db.exec('BEGIN')
  try {
    for (const r of rows) {
      stmt.run(
        accountId, folder, r.uid, r.subject,
        r.from?.name ?? '', r.from?.address ?? '', JSON.stringify(r.to ?? []),
        r.date, r.date ? Date.parse(r.date) : 0, r.snippet,
        r.unread ? 1 : 0, r.flagged ? 1 : 0, r.size ?? 0, at,
      )
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return rows.length
}

/** 删行：不给 uids 就清空这个账号-文件夹（uidValidity 变了要整段重建） */
export function deleteRows(accountId: number, folder: string, uids?: number[]): number {
  if (uids && !uids.length) return 0
  if (!uids) return run('DELETE FROM mail_messages WHERE account_id = ? AND folder = ?', accountId, folder).changes
  let n = 0
  for (const part of chunk(uids, 500)) {
    n += run(
      'DELETE FROM mail_messages WHERE account_id = ? AND folder = ? AND uid IN (' + placeholders(part.length) + ')',
      accountId, folder, ...part,
    ).changes
  }
  return n
}

export function uidFlags(accountId: number, folder: string): UidFlag[] {
  return all<UidFlag>('SELECT uid, unread FROM mail_messages WHERE account_id = ? AND folder = ?', accountId, folder)
}

/** 只写有变化的未读标记（服务器上是未读 ↔ 已读） */
export function applyFlags(accountId: number, folder: string, changes: UidFlag[]): number {
  if (!changes.length) return 0
  const stmt = db.prepare('UPDATE mail_messages SET unread = ? WHERE account_id = ? AND folder = ? AND uid = ?')
  db.exec('BEGIN')
  try {
    for (const c of changes) stmt.run(c.unread, accountId, folder, c.uid)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return changes.length
}

export function countRows(accountId: number, folder: string): number {
  return get<{ n: number }>('SELECT COUNT(*) AS n FROM mail_messages WHERE account_id = ? AND folder = ?', accountId, folder)?.n ?? 0
}

type DbMessage = {
  account_id: number
  folder: string
  uid: number
  subject: string
  from_name: string
  from_addr: string
  to_json: string
  date: string | null
  snippet: string
  unread: number
  flagged: number
  size: number
}

function toRow(r: DbMessage): MailRow {
  let to: Addr[] = []
  try { to = JSON.parse(r.to_json || '[]') } catch { to = [] }
  const from: Addr | null = r.from_addr || r.from_name ? { name: r.from_name, address: r.from_addr } : null
  return {
    accountId: r.account_id,
    folder: r.folder,
    uid: Number(r.uid),
    subject: r.subject,
    from,
    to,
    date: r.date,
    snippet: r.snippet,
    unread: Number(r.unread) === 1,
    flagged: Number(r.flagged) === 1,
    size: Number(r.size),
  }
}

/** 合并列表的一页：时间倒序 → uid 倒序 → 账号正序（与 rows.ts 的 compareRows 同一口径） */
export function pageRows(accountIds: number[], folder: string, offset: number, limit: number): { items: MailRow[]; total: number } {
  if (!accountIds.length) return { items: [], total: 0 }
  const ph = placeholders(accountIds.length)
  const where = ' WHERE folder = ? AND account_id IN (' + ph + ')'
  const items = all<DbMessage>(
    'SELECT account_id, folder, uid, subject, from_name, from_addr, to_json, date, snippet, unread, flagged, size' +
    ' FROM mail_messages' + where + ' ORDER BY ts DESC, uid DESC, account_id ASC LIMIT ? OFFSET ?',
    folder, ...accountIds, limit, offset,
  ).map(toRow)
  const total = get<{ n: number }>('SELECT COUNT(*) AS n FROM mail_messages' + where, folder, ...accountIds)?.n ?? 0
  return { items, total }
}

// ---------- 正文 ----------

const INSERT_BODY = `INSERT INTO mail_bodies
  (account_id, folder, uid, subject, from_json, to_json, cc_json, date, message_id, text, html, attachments_json, bytes, fetched_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(account_id, folder, uid) DO UPDATE SET
    subject = excluded.subject, from_json = excluded.from_json, to_json = excluded.to_json, cc_json = excluded.cc_json,
    date = excluded.date, message_id = excluded.message_id, text = excluded.text, html = excluded.html,
    attachments_json = excluded.attachments_json, bytes = excluded.bytes, fetched_at = excluded.fetched_at`

export function putBody(message: MailMessage): void {
  run(
    INSERT_BODY,
    message.accountId, message.folder, message.uid, message.subject,
    JSON.stringify(message.from), JSON.stringify(message.to ?? []), JSON.stringify(message.cc ?? []),
    message.date, message.messageId, message.text, message.html,
    JSON.stringify(message.attachments ?? []), Buffer.byteLength(message.text || '', 'utf8'), nowIso(),
  )
}

export function getBody(accountId: number, folder: string, uid: number): MailMessage | undefined {
  const r = get<any>('SELECT * FROM mail_bodies WHERE account_id = ? AND folder = ? AND uid = ?', accountId, folder, uid)
  if (!r) return undefined
  const parse = (v: string | null, fallback: any) => {
    if (!v) return fallback
    try { return JSON.parse(v) } catch { return fallback }
  }
  return {
    accountId: Number(r.account_id),
    folder: String(r.folder),
    uid: Number(r.uid),
    subject: String(r.subject || ''),
    from: parse(r.from_json, null),
    to: parse(r.to_json, []),
    cc: parse(r.cc_json, []),
    date: r.date ?? null,
    messageId: r.message_id ?? null,
    text: String(r.text || ''),
    html: r.html ?? null,
    attachments: parse(r.attachments_json, []),
  }
}

export function deleteBodies(accountId: number, folder?: string): number {
  return folder
    ? run('DELETE FROM mail_bodies WHERE account_id = ? AND folder = ?', accountId, folder).changes
    : run('DELETE FROM mail_bodies WHERE account_id = ?', accountId).changes
}

// ---------- 同步状态 ----------

const INSERT_STATE = `INSERT INTO mail_sync_state
  (account_id, folder, uid_validity, uid_next, total, unseen, done, status, error, last_sync_at, ms)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(account_id, folder) DO UPDATE SET
    uid_validity = excluded.uid_validity, uid_next = excluded.uid_next, total = excluded.total,
    unseen = excluded.unseen, done = excluded.done, status = excluded.status, error = excluded.error,
    last_sync_at = excluded.last_sync_at, ms = excluded.ms`

export function getState(accountId: number, folder: string): SyncStateRow | undefined {
  return get<SyncStateRow>('SELECT * FROM mail_sync_state WHERE account_id = ? AND folder = ?', accountId, folder)
}

export function listStates(): SyncStateRow[] {
  return all<SyncStateRow>('SELECT * FROM mail_sync_state ORDER BY account_id ASC, folder ASC')
}

export function saveState(v: {
  accountId: number; folder: string; uidValidity: string; uidNext: number
  total: number; unseen: number; done: number; status: string; error: string; lastSyncAt: string | null; ms: number
}): void {
  run(INSERT_STATE, v.accountId, v.folder, v.uidValidity, v.uidNext, v.total, v.unseen, v.done, v.status, v.error, v.lastSyncAt, v.ms)
}

/** 只改「正在同步 / 出错了」这两件事，不动游标（游标只在真同步成功时整块覆盖） */
export function markStatus(accountId: number, folder: string, status: string, error = ''): void {
  const cur = getState(accountId, folder)
  if (!cur) {
    run(
      'INSERT INTO mail_sync_state (account_id, folder, uid_validity, uid_next, total, unseen, done, status, error, last_sync_at, ms) VALUES (?, ?, ?, 0, 0, 0, 0, ?, ?, NULL, 0)',
      accountId, folder, '', status, error,
    )
    return
  }
  run('UPDATE mail_sync_state SET status = ?, error = ? WHERE account_id = ? AND folder = ?', status, error, accountId, folder)
}

/** 首批全量同步时把进度写出来（前端显示「同步中 1200/2551」） */
export function setProgress(accountId: number, folder: string, done: number, total: number): void {
  run('UPDATE mail_sync_state SET done = ?, total = ? WHERE account_id = ? AND folder = ?', done, total, accountId, folder)
}

/** 账号删除时连带清干净（外键已 CASCADE mail_messages，正文和状态自己删） */
export function purgeAccount(accountId: number): void {
  deleteBodies(accountId)
  run('DELETE FROM mail_sync_state WHERE account_id = ?', accountId)
  run('DELETE FROM mail_messages WHERE account_id = ?', accountId)
}

/** 每账号在某个文件夹的未读/总数（读状态表，不扫消息表）；没同步过就没有条目 */
export function folderCounts(accountIds: number[], folder: string): Record<number, { unseen: number; total: number }> {
  const out: Record<number, { unseen: number; total: number }> = {}
  if (!accountIds.length) return out
  const rows = all<{ account_id: number; unseen: number; total: number }>(
    'SELECT account_id, unseen, total FROM mail_sync_state WHERE folder = ? AND account_id IN (' + placeholders(accountIds.length) + ')',
    folder, ...accountIds,
  )
  for (const r of rows) out[Number(r.account_id)] = { unseen: Number(r.unseen), total: Number(r.total) }
  return out
}
