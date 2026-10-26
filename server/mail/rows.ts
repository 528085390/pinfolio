// 邮件列表的行拼装与排序 —— 纯函数，不碰网络，有单测（tests/unit/mail-rows.test.mts）。
// 单独成文件的原因：这几条口径（无主题兜底、\Seen 判未读、INBOX 排最前、时间倒序再 uid 倒序）
// 原来埋在 client.ts 里，一条都测不到。
import type { FolderInfo, MailRow } from './types.js'
import { addrList, addrOne, snippetFromText, toIso } from './parse.js'
import { t } from '../i18n.js'

/** 一条 IMAP fetch 结果 → 列表行。 */
export function toRow(accountId: number, folder: string, m: any): MailRow {
  const flags: Set<string> = m.flags || new Set()
  const bodyPart = m.bodyParts ? (m.bodyParts.get('text') || m.bodyParts.get('TEXT')) : undefined
  return {
    accountId,
    folder,
    uid: Number(m.uid),
    subject: String(m.envelope?.subject || '').trim() || t('(无主题)'),
    from: addrOne(m.envelope?.from),
    to: addrList(m.envelope?.to),
    date: toIso(m.internalDate || m.envelope?.date),
    snippet: snippetFromText(bodyPart),
    unread: !flags.has('\\Seen'),
    flagged: flags.has('\\Flagged'),
    size: Number(m.size || 0),
  }
}

/** 排序用的时间戳：没有日期按 0。 */
export function rowTime(r: MailRow): number {
  return r.date ? Date.parse(r.date) : 0
}

/** 多账号归并时的先后：时间倒序 → uid 倒序 → 账号 id 正序（保证结果稳定）。 */
export function compareRows(p: MailRow, q: MailRow): number {
  return rowTime(q) - rowTime(p) || q.uid - p.uid || p.accountId - q.accountId
}

/** IMAP LIST 结果 → 可展示的文件夹（丢掉 \\Noselect，补默认 delimiter 与 name）。 */
export function filterSelectable(raw: any[]): FolderInfo[] {
  return raw
    .filter((m: any) => ![...(m.flags || [])].some((f: string) => /\\noselect/i.test(f)))
    .map((m: any) => ({ path: m.path, name: m.name || m.path, delimiter: m.delimiter || '/', specialUse: m.specialUse || null }))
}

/** 文件夹排序：INBOX 永远第一，然后是带 special-use 的（收件箱/已发送…），最后按名字（中文按拼音）。原地排。 */
export function sortFolders(folders: FolderInfo[]): FolderInfo[] {
  folders.sort((x, y) => {
    if (x.path.toUpperCase() === 'INBOX') return -1
    if (y.path.toUpperCase() === 'INBOX') return 1
    const sx = x.specialUse ? 1 : 0
    const sy = y.specialUse ? 1 : 0
    if (sx !== sy) return sy - sx
    return x.path.localeCompare(y.path, 'zh-CN')
  })
  return folders
}
