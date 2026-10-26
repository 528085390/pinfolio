/**
 * 邮件 HTTP 面的**参数解析与纯拼装**（2026-10-21 从 routes.ts 拆出）。
 * 这里不碰 IMAP、不碰数据库，所以能单测；路由只负责取账号、调 client、拼响应。
 */

import { t } from '../i18n.js'
export const DEFAULT_FOLDER = 'INBOX'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

/** 列表接口的查询参数：`account` 可以是 `all` 或某个 id。 */
export type ListQuery = { which: string; folder: string; limit: number; offset: number; fresh: boolean }

export function parseListQuery(q: Record<string, string | undefined>): ListQuery {
  const which = (q.account || 'all').trim()
  const folder = (q.folder || DEFAULT_FOLDER).trim() || DEFAULT_FOLDER
  const limit = Math.min(Math.max(Number(q.limit || DEFAULT_LIMIT), 1), MAX_LIMIT)
  const offset = Math.max(Number(q.offset || 0), 0)
  return { which, folder, limit, offset, fresh: q.fresh === '1' }
}

/** 只取启用中的账号；`all` 就是全部，否则按 id 过滤。空数组 = 这个 id 不存在或已停用。 */
export function pickTargets<T extends { id: number; enabled: number }>(accounts: T[], which: string): T[] {
  return which === 'all' ? accounts : accounts.filter((a) => String(a.id) === which)
}

/** 列表行补上账号标签 / 邮箱 / 本地已读标记（`accountId:uid` 作键）。 */
export function decorateItems<T extends { accountId: number; uid: number }>(
  items: T[],
  target: { id: number; label: string; email: string }[],
  marks: Set<string>,
): (T & { accountLabel: string; accountEmail: string; localRead: boolean })[] {
  return items.map((r) => {
    const acc = target.find((a) => a.id === r.accountId)
    return {
      ...r,
      accountLabel: acc?.label || '',
      accountEmail: acc?.email || '',
      localRead: marks.has(r.accountId + ':' + r.uid),
    }
  })
}

/** 账号列表把未读/总数/错误并进每个账号；没取到计数时是 null（前端据此显示「—」）。 */
export function mergeAccountCounts<A extends { id: number }>(
  accounts: A[],
  counts: Record<number, { unseen: number; total: number }>,
  errors: { accountId: number; label: string; error: string }[],
): (A & { unseen: number | null; total: number | null; error: string | null })[] {
  return accounts.map((a) => ({
    ...a,
    unseen: counts[a.id]?.unseen ?? null,
    total: counts[a.id]?.total ?? null,
    error: errors.find((e) => e.accountId === a.id)?.error ?? null,
  }))
}

/** uid / index 这类正整数参数：不合法回 null。 */
export function posInt(raw: unknown): number | null {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

export type AttachmentQuery = { folder: string; uid: number; index: number }

/** 附件接口的查询参数；`index` 允许 0，`uid` 必须为正。 */
export function parseAttachmentQuery(q: Record<string, string | undefined>): AttachmentQuery | { error: string } {
  const folder = (q.folder || DEFAULT_FOLDER).trim() || DEFAULT_FOLDER
  const uid = Number(q.uid)
  const index = Number(q.index)
  if (!Number.isFinite(uid) || uid <= 0 || !Number.isFinite(index) || index < 0) return { error: t('参数不合法') }
  return { folder, uid, index }
}

/** 附件下载头：文件名里的中文走 `filename*`，`filename` 只留 ASCII 兜底（不能带引号/反斜杠）。 */
export function attachmentHeaders(meta: { filename?: string | null; contentType?: string | null }, size: number): Record<string, string> {
  const filename = meta.filename || 'attachment'
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return {
    'Content-Type': meta.contentType || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Content-Length': String(size),
    'Cache-Control': 'private, max-age=600',
  }
}

/** 「测试连接」的入参：空字段用默认值；带了 `id` 就用库里那份补齐空着的字段。 */
export type TestInput = { host: string; port: number; username: string; password: string; security: string; proxy: string }

export function testInputFrom(body: any): TestInput {
  return {
    host: String(body?.host ?? '').trim(),
    port: Number(body?.port ?? 993),
    username: String(body?.username ?? '').trim(),
    password: body?.password === undefined ? '' : String(body.password),
    security: String(body?.security ?? 'ssl'),
    proxy: body?.proxy === undefined ? '' : String(body.proxy),
  }
}

/** 只补空着的字段（已经填了的一律用表单里的，用户改完就能测新配置）。 */
export function fillTestInput(input: TestInput, body: any, acc: TestInput): TestInput {
  return {
    host: input.host || acc.host,
    port: Number(body?.port ?? acc.port),
    username: input.username || acc.username,
    password: input.password || acc.password,
    security: input.security || acc.security,
    proxy: input.proxy || acc.proxy,
  }
}

/** 三项必填，缺一个都不能连。 */
export function missingTestField(input: TestInput): boolean {
  return !input.host || !input.username || !input.password
}

/** 「标为已读」的 body：account 与 uid 都得是数字。 */
export function parseMarkBody(body: any): { account: number; folder: string; uid: number } | { error: string } {
  const account = Number(body?.account)
  const uid = Number(body?.uid)
  const folder = String(body?.folder || DEFAULT_FOLDER)
  if (!Number.isFinite(account) || !Number.isFinite(uid)) return { error: '参数不合法' }
  return { account, folder, uid }
}

/**
 * 「清本地已读」的三档：
 * - `account` 缺省或 `all` → 全清（设置页的「清除本地已读标记」）
 * - 有 `account` 没 `uid` → 清这个账号
 * - 都有 → 只取消这一封
 */
export type ClearQuery =
  | { mode: 'all' }
  | { mode: 'account'; account: number }
  | { mode: 'one'; account: number; folder: string; uid: number }

export function parseClearQuery(q: Record<string, string | undefined>): ClearQuery {
  const account = q.account
  const folder = q.folder || DEFAULT_FOLDER
  const uid = Number(q.uid)
  if (account === 'all' || account === undefined) return { mode: 'all' }
  if (!Number.isFinite(uid)) return { mode: 'account', account: Number(account) }
  return { mode: 'one', account: Number(account), folder, uid }
}
