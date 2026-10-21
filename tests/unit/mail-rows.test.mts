import test from 'node:test'
import assert from 'node:assert/strict'
import { compareRows, filterSelectable, rowTime, sortFolders, toRow } from '../../server/mail/rows.js'
import type { FolderInfo, MailRow } from '../../server/mail/types.js'

const row = (over: Partial<MailRow>): MailRow => ({
  accountId: 1, folder: 'INBOX', uid: 1, subject: 's', from: null, to: [],
  date: '2026-10-21T00:00:00.000Z', snippet: '', unread: false, flagged: false, size: 0,
  ...over,
})

test('toRow：envelope 归一、无主题兜底', () => {
  const r = toRow(3, 'INBOX', {
    uid: '42', size: '1024',
    envelope: { subject: '  你好  ', from: [{ name: '张三', address: 'a@b.com' }], to: [{ address: 'c@d.com' }], date: '2026-10-20T01:02:03.000Z' },
    flags: new Set(['\\Seen']),
  })
  assert.equal(r.accountId, 3)
  assert.equal(r.folder, 'INBOX')
  assert.equal(r.uid, 42)
  assert.equal(r.size, 1024)
  assert.equal(r.subject, '你好')
  assert.equal(r.unread, false)
  assert.equal(r.flagged, false)
  assert.equal(r.from?.address, 'a@b.com')
  assert.equal(r.to.length, 1)
  assert.equal(r.date, '2026-10-20T01:02:03.000Z')
})

test('toRow：空主题给 (无主题)、没 \\Seen 算未读、bodyParts 取 TEXT 做摘要', () => {
  const r = toRow(1, 'INBOX', {
    uid: 7, envelope: { subject: '   ' },
    flags: new Set(['\\Flagged']),
    bodyParts: new Map([['TEXT', Buffer.from('  摘要正文  ')]]),
  })
  assert.equal(r.subject, '(无主题)')
  assert.equal(r.unread, true)
  assert.equal(r.flagged, true)
  assert.equal(r.snippet, '摘要正文')
  assert.equal(r.from, null)
  assert.deepEqual(r.to, [])
  assert.equal(r.date, null)
})

test('toRow：没有 flags / envelope 也不炸', () => {
  const r = toRow(1, 'INBOX', { uid: 1 })
  assert.equal(r.unread, true)
  assert.equal(r.flagged, false)
  assert.equal(r.subject, '(无主题)')
  assert.equal(r.size, 0)
})

test('rowTime：没有日期算 0，解析不了是 NaN（实测行为，别改成猜的）', () => {
  assert.equal(rowTime(row({ date: null })), 0)
  assert.equal(rowTime(row({ date: '2026-10-21T00:00:00.000Z' })), Date.parse('2026-10-21T00:00:00.000Z'))
  assert.ok(Number.isNaN(rowTime(row({ date: '乱码' }))))
})

test('compareRows：时间倒序 → uid 倒序 → 账号正序', () => {
  const a = row({ accountId: 2, uid: 5, date: '2026-10-21T00:00:00.000Z' })
  const b = row({ accountId: 1, uid: 9, date: '2026-10-20T00:00:00.000Z' })
  const sorted = [b, a].sort(compareRows)
  assert.deepEqual(sorted.map((r) => r.accountId), [2, 1])

  const sameTime = [row({ accountId: 1, uid: 3 }), row({ accountId: 1, uid: 8 })].sort(compareRows)
  assert.deepEqual(sameTime.map((r) => r.uid), [8, 3])

  const sameAll = [row({ accountId: 9 }), row({ accountId: 4 })].sort(compareRows)
  assert.deepEqual(sameAll.map((r) => r.accountId), [4, 9])
})

test('filterSelectable：丢掉 \\Noselect、补 name/delimiter、specialUse 缺省 null', () => {
  const out = filterSelectable([
    { path: 'INBOX', name: '收件箱', delimiter: '/', specialUse: '\\Inbox' },
    { path: '[Gmail]', flags: new Set(['\\Noselect']) },
    { path: 'Archive' },
  ])
  assert.deepEqual(out, [
    { path: 'INBOX', name: '收件箱', delimiter: '/', specialUse: '\\Inbox' },
    { path: 'Archive', name: 'Archive', delimiter: '/', specialUse: null },
  ])
})

test('filterSelectable：\\noselect 大小写不敏感', () => {
  const out = filterSelectable([{ path: 'x', flags: ['\\NOSELECT'] }, { path: 'y' }])
  assert.deepEqual(out.map((f) => f.path), ['y'])
})

test('sortFolders：INBOX 最前，带 special-use 的其次，其余按名字（中文按拼音）', () => {
  const folders: FolderInfo[] = [
    { path: 'Sent', name: 'Sent', delimiter: '/', specialUse: '\\Sent' },
    { path: 'zeta', name: 'zeta', delimiter: '/', specialUse: null },
    { path: 'INBOX', name: 'INBOX', delimiter: '/', specialUse: null },
    { path: 'Alpha', name: 'Alpha', delimiter: '/', specialUse: null },
    { path: 'Drafts', name: 'Drafts', delimiter: '/', specialUse: '\\Drafts' },
  ]
  assert.deepEqual(sortFolders(folders).map((f) => f.path), ['INBOX', 'Drafts', 'Sent', 'Alpha', 'zeta'])
})

test('sortFolders：小写 inbox 也排第一，且原地排序', () => {
  const folders: FolderInfo[] = [
    { path: 'b', name: 'b', delimiter: '/', specialUse: null },
    { path: 'inbox', name: 'inbox', delimiter: '/', specialUse: null },
  ]
  const out = sortFolders(folders)
  assert.equal(out, folders)
  assert.deepEqual(out.map((f) => f.path), ['inbox', 'b'])
})
