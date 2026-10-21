import { all, get, run, nowIso } from '../db.js'
import { normalizeProxy } from './proxy.js'

// 代理地址规范化在 proxy.ts（纯函数，可单测）；这里再导出，老的 './store.js' 调用点不用改。
export { normalizeProxy }

export type Security = 'ssl' | 'starttls' | 'none'

export type MailAccountRow = {
  id: number
  label: string
  email: string
  host: string
  port: number
  username: string
  password: string
  security: string
  proxy: string
  enabled: number
  sort: number
  created_at: string
  updated_at: string
}

/** 对外暴露的账号（不含密码） */
export type MailAccountPublic = Omit<MailAccountRow, 'password'> & { hasPassword: boolean }

export function publicAccount(row: MailAccountRow): MailAccountPublic {
  const { password, ...rest } = row
  return { ...rest, hasPassword: !!password }
}

export function listAccounts(includeDisabled = true): MailAccountRow[] {
  const sql = 'SELECT * FROM mail_accounts' + (includeDisabled ? '' : ' WHERE enabled = 1') +
    ' ORDER BY sort ASC, id ASC'
  return all<MailAccountRow>(sql)
}

export function getAccount(id: number): MailAccountRow | undefined {
  return get<MailAccountRow>('SELECT * FROM mail_accounts WHERE id = ?', id)
}

export type AccountInput = {
  label?: string
  email?: string
  host?: string
  port?: number | string
  username?: string
  password?: string
  security?: string
  proxy?: string
  enabled?: boolean | number | string
  sort?: number | string
}

export function normalizeAccountInput(body: AccountInput) {
  const host = String(body.host ?? '').trim()
  const username = String(body.username ?? '').trim()
  const port = Number(body.port ?? 993)
  const security = String(body.security ?? 'ssl').toLowerCase()
  const label = String(body.label ?? '').trim()
  const email = String(body.email ?? '').trim()
  const password = body.password === undefined ? undefined : String(body.password)
  // proxy 不传 = 不改（编辑时前端没这个字段也不会把已有代理清掉）；传空串 = 显式改成直连
  const proxy: { value: string | undefined } | { error: string } =
    body.proxy === undefined ? { value: undefined } : normalizeProxy(body.proxy)
  if ('error' in proxy) return { error: proxy.error }
  const enabled = body.enabled === undefined ? 1 : (body.enabled === true || body.enabled === 1 || body.enabled === '1' ? 1 : 0)
  const sort = Number(body.sort ?? 0)

  if (!host) return { error: '请填写 IMAP 服务器地址' as string }
  if (!/^[a-zA-Z0-9.\-_:\[\]]+$/.test(host)) return { error: '服务器地址格式不正确' as string }
  if (!username) return { error: '请填写用户名' as string }
  if (!Number.isFinite(port) || port < 1 || port > 65535) return { error: '端口必须是 1-65535 之间的数字' as string }
  if (security !== 'ssl' && security !== 'starttls' && security !== 'none') return { error: '加密方式只能是 SSL/TLS、STARTTLS 或（调试用）不加密' as string }
  return {
    value: {
      host,
      username,
      port,
      security: security as Security,
      label,
      email,
      password,
      proxy: proxy.value,
      enabled,
      sort: Number.isFinite(sort) ? sort : 0,
    },
  }
}

export function createAccount(v: {
  host: string; username: string; port: number; security: Security; label: string; email: string; password?: string; proxy?: string; enabled: number; sort: number
}): MailAccountRow {
  const now = nowIso()
  const r = run(
    'INSERT INTO mail_accounts (label, email, host, port, username, password, security, proxy, enabled, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    v.label, v.email, v.host, v.port, v.username, v.password ?? '', v.security, v.proxy ?? '', v.enabled, v.sort, now, now,
  )
  return getAccount(r.id)!
}

export function updateAccount(id: number, v: Partial<{
  host: string; username: string; port: number; security: Security; label: string; email: string; password: string; proxy: string; enabled: number; sort: number
}>): MailAccountRow | undefined {
  const cur = getAccount(id)
  if (!cur) return undefined
  const next = {
    label: v.label ?? cur.label,
    email: v.email ?? cur.email,
    host: v.host ?? cur.host,
    port: v.port ?? cur.port,
    username: v.username ?? cur.username,
    password: v.password === undefined || v.password === '' ? cur.password : v.password,
    security: v.security ?? (cur.security as Security),
    proxy: v.proxy ?? cur.proxy,
    enabled: v.enabled ?? cur.enabled,
    sort: v.sort ?? cur.sort,
  }
  run(
    'UPDATE mail_accounts SET label = ?, email = ?, host = ?, port = ?, username = ?, password = ?, security = ?, proxy = ?, enabled = ?, sort = ?, updated_at = ? WHERE id = ?',
    next.label, next.email, next.host, next.port, next.username, next.password, next.security, next.proxy, next.enabled, next.sort, nowIso(), id,
  )
  return getAccount(id)
}

export function deleteAccount(id: number): boolean {
  const r = run('DELETE FROM mail_accounts WHERE id = ?', id)
  run('DELETE FROM mail_local_read WHERE account_id = ?', id)
  return r.changes > 0
}

// ---- 本地已读标记（绝不写回服务器）----

export function localReadKeys(accountIds: number[], folder: string): Set<string> {
  const out = new Set<string>()
  if (!accountIds.length) return out
  const rows = all<{ account_id: number; uid: number }>(
    'SELECT account_id, uid FROM mail_local_read WHERE folder = ? AND account_id IN (' + accountIds.map(() => '?').join(',') + ')',
    folder, ...accountIds,
  )
  for (const r of rows) out.add(r.account_id + ':' + r.uid)
  return out
}

export function markLocalRead(accountId: number, folder: string, uid: number) {
  run(
    'INSERT INTO mail_local_read (account_id, folder, uid, read_at) VALUES (?, ?, ?, ?) ON CONFLICT(account_id, folder, uid) DO UPDATE SET read_at = excluded.read_at',
    accountId, folder, uid, nowIso(),
  )
}

export function unmarkLocalRead(accountId: number, folder: string, uid: number) {
  run('DELETE FROM mail_local_read WHERE account_id = ? AND folder = ? AND uid = ?', accountId, folder, uid)
}

export function clearLocalRead(accountId?: number) {
  if (accountId === undefined) run('DELETE FROM mail_local_read')
  else run('DELETE FROM mail_local_read WHERE account_id = ?', accountId)
}

export function localReadCount(): number {
  return get<{ n: number }>('SELECT COUNT(*) AS n FROM mail_local_read')?.n ?? 0
}
