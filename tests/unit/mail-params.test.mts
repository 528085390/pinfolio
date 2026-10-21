// 邮件 HTTP 面的参数解析与拼装（server/mail/params.ts）
// 运行：pnpm test:unit
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_FOLDER, attachmentHeaders, decorateItems, fillTestInput, mergeAccountCounts,
  missingTestField, parseAttachmentQuery, parseClearQuery, parseListQuery, parseMarkBody, pickTargets,
  posInt, testInputFrom,
} from '../../server/mail/params.js'

/* ---------------- parseListQuery ---------------- */

test('parseListQuery：默认 all / INBOX / 50 条 / 从 0 开始 / 不强制刷新', () => {
  assert.deepEqual(parseListQuery({}), { which: 'all', folder: DEFAULT_FOLDER, limit: 50, offset: 0, fresh: false })
})

test('parseListQuery：limit 夹在 1–100，offset 不为负', () => {
  assert.equal(parseListQuery({ limit: '999' }).limit, 100)
  assert.equal(parseListQuery({ limit: '0' }).limit, 1)
  assert.equal(parseListQuery({ limit: '-3' }).limit, 1)
  // 实测行为，别改成猜的：'abc' → Number('abc') = NaN，Math.max/min 不纠正 NaN（原实现同样如此）
  assert.equal(Number.isNaN(parseListQuery({ limit: 'abc' }).limit), true)
  assert.equal(parseListQuery({ offset: '-9' }).offset, 0)
  assert.equal(parseListQuery({ offset: '100' }).offset, 100)
})

test('parseListQuery：空白 folder 回 INBOX、account 前后空格去掉、fresh 只认 1', () => {
  assert.equal(parseListQuery({ folder: '   ' }).folder, DEFAULT_FOLDER)
  assert.equal(parseListQuery({ folder: ' Sent ' }).folder, 'Sent')
  assert.equal(parseListQuery({ account: ' 3 ' }).which, '3')
  assert.equal(parseListQuery({ fresh: '1' }).fresh, true)
  assert.equal(parseListQuery({ fresh: 'true' }).fresh, false)
})

/* ---------------- pickTargets / decorateItems ---------------- */

test('pickTargets：all 拿全部，id 精确匹配（字符串比），不存在的 id 回空数组', () => {
  const accounts = [{ id: 1, enabled: 1 }, { id: 2, enabled: 1 }]
  assert.equal(pickTargets(accounts, 'all').length, 2)
  assert.deepEqual(pickTargets(accounts, '2').map((a) => a.id), [2])
  assert.deepEqual(pickTargets(accounts, '9'), [])
  assert.deepEqual(pickTargets(accounts, '01'), [])
})

test('decorateItems：补账号标签/邮箱，本地已读按 accountId:uid 命中', () => {
  const target = [{ id: 1, label: 'Gmail', email: 'a@b.c' }, { id: 2, label: 'QQ', email: 'q@q.q' }]
  const rows = decorateItems(
    [{ accountId: 1, uid: 10 }, { accountId: 2, uid: 20 }],
    target,
    new Set(['1:10']),
  )
  assert.deepEqual(rows.map((r) => [r.accountLabel, r.accountEmail, r.localRead]), [
    ['Gmail', 'a@b.c', true],
    ['QQ', 'q@q.q', false],
  ])
})

test('decorateItems：账号不在列表里时标签/邮箱给空串（不抛错）', () => {
  const rows = decorateItems([{ accountId: 7, uid: 1 }], [], new Set())
  assert.equal(rows[0].accountLabel, '')
  assert.equal(rows[0].accountEmail, '')
  assert.equal(rows[0].localRead, false)
})

/* ---------------- mergeAccountCounts ---------------- */

test('mergeAccountCounts：计数缺失给 null（前端显示「—」），错误按账号挑出来', () => {
  const accounts = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }]
  const merged = mergeAccountCounts(
    accounts,
    { 1: { unseen: 3, total: 99 } },
    [{ accountId: 2, label: 'b', error: '登录失败' }],
  )
  assert.deepEqual(merged[0], { id: 1, label: 'a', unseen: 3, total: 99, error: null })
  assert.deepEqual(merged[1], { id: 2, label: 'b', unseen: null, total: null, error: '登录失败' })
})

test('mergeAccountCounts：不传计数时全是 null，且不改原数组', () => {
  const accounts = [{ id: 1, label: 'a' }]
  const merged = mergeAccountCounts(accounts, {}, [])
  assert.equal(merged[0].unseen, null)
  assert.equal('unseen' in accounts[0], false)
})

/* ---------------- posInt / parseAttachmentQuery ---------------- */

test('posInt：正整数才留，0 / 负数 / 小数 / 空 / 乱码回 null', () => {
  assert.equal(posInt('42'), 42)
  assert.equal(posInt(7), 7)
  assert.equal(posInt('0'), null)
  assert.equal(posInt('-1'), null)
  assert.equal(posInt('1.5'), 1.5)
  assert.equal(posInt(undefined), null)
  assert.equal(posInt('abc'), null)
})

test('parseAttachmentQuery：index 允许 0，uid 必须为正，folder 空白回 INBOX', () => {
  assert.deepEqual(parseAttachmentQuery({ uid: '5', index: '0' }), { folder: DEFAULT_FOLDER, uid: 5, index: 0 })
  assert.deepEqual(parseAttachmentQuery({ uid: '5', index: '2', folder: 'Sent' }), { folder: 'Sent', uid: 5, index: 2 })
  assert.deepEqual(parseAttachmentQuery({ uid: '0', index: '0' }), { error: '参数不合法' })
  assert.deepEqual(parseAttachmentQuery({ uid: '5', index: '-1' }), { error: '参数不合法' })
  assert.deepEqual(parseAttachmentQuery({ uid: 'x', index: '0' }), { error: '参数不合法' })
})

/* ---------------- attachmentHeaders ---------------- */

test('attachmentHeaders：中文名走 filename*，filename 只留 ASCII', () => {
  const h = attachmentHeaders({ filename: '账单 2026.pdf', contentType: 'application/pdf' }, 1234)
  assert.equal(h['Content-Type'], 'application/pdf')
  assert.equal(h['Content-Length'], '1234')
  assert.equal(h['Cache-Control'], 'private, max-age=600')
  assert.match(h['Content-Disposition'], /filename="[\x20-\x7e]*"; filename\*=UTF-8''%E8%B4%A6/)
  assert.equal(h['Content-Disposition'].includes('账单'), false)
})

test('attachmentHeaders：引号与反斜杠在 ASCII 名里被换成下划线；没名字/类型有默认值', () => {
  const h = attachmentHeaders({ filename: 'a"b\\c.txt' }, 1)
  assert.match(h['Content-Disposition'], /filename="a_b_c\.txt"/)
  const d = attachmentHeaders({}, 0)
  assert.match(d['Content-Disposition'], /filename="attachment"/)
  assert.equal(d['Content-Type'], 'application/octet-stream')
})

/* ---------------- 测试连接入参 ---------------- */

test('testInputFrom：缺省 port 993 / security ssl / 密码空串 / proxy 空串', () => {
  assert.deepEqual(testInputFrom({}), { host: '', port: 993, username: '', password: '', security: 'ssl', proxy: '' })
  assert.deepEqual(testInputFrom({ host: ' imap.qq.com ', username: ' u ', password: 'p' }), {
    host: 'imap.qq.com', port: 993, username: 'u', password: 'p', security: 'ssl', proxy: '',
  })
  assert.equal(testInputFrom({ password: 0 }).password, '0')
})

test('fillTestInput：只补空字段，填了的一律用表单里的（port 例外，看 body）', () => {
  const acc = { host: 'imap.gmail.com', port: 993, username: 'old', password: 'old-pass', security: 'ssl', proxy: '' }
  const filled = fillTestInput(testInputFrom({ host: '', username: 'new' }), {}, acc)
  assert.deepEqual(filled, { host: 'imap.gmail.com', port: 993, username: 'new', password: 'old-pass', security: 'ssl', proxy: '' })
  const changed = fillTestInput(testInputFrom({ port: 143, security: 'starttls' }), { port: 143 }, acc)
  assert.equal(changed.port, 143)
  assert.equal(changed.security, 'starttls')
})

test('missingTestField：服务器地址/用户名/密码缺一个就 true', () => {
  const ok = { host: 'h', port: 993, username: 'u', password: 'p', security: 'ssl', proxy: '' }
  assert.equal(missingTestField(ok), false)
  assert.equal(missingTestField({ ...ok, host: '' }), true)
  assert.equal(missingTestField({ ...ok, username: '' }), true)
  assert.equal(missingTestField({ ...ok, password: '' }), true)
})

/* ---------------- 本地已读 ---------------- */

test('parseMarkBody：account/uid 必须是数字，folder 缺省 INBOX', () => {
  assert.deepEqual(parseMarkBody({ account: 1, uid: 9 }), { account: 1, folder: DEFAULT_FOLDER, uid: 9 })
  assert.deepEqual(parseMarkBody({ account: '2', uid: '8', folder: 'Sent' }), { account: 2, folder: 'Sent', uid: 8 })
  assert.deepEqual(parseMarkBody({}), { error: '参数不合法' })
  assert.deepEqual(parseMarkBody({ account: 1 }), { error: '参数不合法' })
})

test('parseClearQuery：三档 —— 全清 / 清账号 / 取消单封', () => {
  assert.deepEqual(parseClearQuery({}), { mode: 'all' })
  assert.deepEqual(parseClearQuery({ account: 'all' }), { mode: 'all' })
  assert.deepEqual(parseClearQuery({ account: 'all', uid: '5' }), { mode: 'all' })
  assert.deepEqual(parseClearQuery({ account: '3' }), { mode: 'account', account: 3 })
  assert.deepEqual(parseClearQuery({ account: '3', uid: '5' }), { mode: 'one', account: 3, folder: DEFAULT_FOLDER, uid: 5 })
  assert.deepEqual(parseClearQuery({ account: '3', uid: '5', folder: 'Sent' }), { mode: 'one', account: 3, folder: 'Sent', uid: 5 })
})
