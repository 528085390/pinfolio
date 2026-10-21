import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyPreset,
  blankForm,
  buildBody,
  canTest,
  EMPTY,
  hintsFor,
  PRESETS,
  securityLabel,
  toForm,
} from '../../web/components/mail-account/form.js'

test('blankForm：默认 ssl + 993，其余空', () => {
  assert.deepEqual(blankForm(), EMPTY)
  assert.equal(EMPTY.port, '993')
  assert.equal(EMPTY.security, 'ssl')
  assert.equal(EMPTY.id, null)
})

test('blankForm：返回新对象，改一个不影响下一个', () => {
  const a = blankForm()
  a.host = 'x'
  assert.equal(blankForm().host, '')
})

test('toForm：端口转字符串，密码永远留空（留空=不修改）', () => {
  const f = toForm({ id: 7, label: '个人', email: 'a@b.com', host: 'imap.gmail.com', port: 993, username: 'a@b.com', security: 'starttls', proxy: 'socks5://127.0.0.1:1080' } as any)
  assert.deepEqual(f, {
    id: 7,
    label: '个人',
    email: 'a@b.com',
    host: 'imap.gmail.com',
    port: '993',
    username: 'a@b.com',
    password: '',
    security: 'starttls',
    proxy: 'socks5://127.0.0.1:1080',
  })
})

test('toForm：security 缺省回 ssl，proxy 缺省回空串', () => {
  const f = toForm({ id: 1, label: '', email: '', host: 'h', port: 143, username: 'u' } as any)
  assert.equal(f.security, 'ssl')
  assert.equal(f.proxy, '')
  assert.equal(f.port, '143')
})

test('applyPreset：只改服务器 / 端口 / 加密，不冲掉已填的用户名密码', () => {
  const before = { ...blankForm(), username: 'me@gmail.com', password: 'pwd', label: '我的' }
  const after = applyPreset(before, 'imap.gmail.com')
  assert.equal(after.host, 'imap.gmail.com')
  assert.equal(after.port, '993')
  assert.equal(after.security, 'ssl')
  assert.equal(after.username, 'me@gmail.com')
  assert.equal(after.password, 'pwd')
  assert.equal(after.label, '我的')
})

test('buildBody：端口转数字，端口乱填回 993', () => {
  const body = buildBody({ ...blankForm(), host: 'h', port: 'abc' })
  assert.equal(body.port, 993)
  const body2 = buildBody({ ...blankForm(), host: 'h', port: '143' })
  assert.equal(body2.port, 143)
})

test('buildBody：新增时必须带 password（哪怕是空串）', () => {
  const body = buildBody({ ...blankForm(), host: 'h', password: '' })
  assert.ok('password' in body)
  assert.equal(body.password, '')
})

test('buildBody：编辑时密码留空就不发这个字段', () => {
  const body = buildBody({ ...blankForm(), id: 9, host: 'h', password: '' })
  assert.equal('password' in body, false)
})

test('buildBody：编辑时填了新密码就发', () => {
  const body = buildBody({ ...blankForm(), id: 9, host: 'h', password: 'new' })
  assert.equal(body.password, 'new')
})

test('canTest：服务器和用户名都填了才能测', () => {
  assert.equal(canTest({ ...blankForm(), host: 'h', username: 'u' }), true)
  assert.equal(canTest({ ...blankForm(), host: 'h' }), false)
  assert.equal(canTest({ ...blankForm(), username: 'u' }), false)
  assert.equal(canTest(blankForm()), false)
})

test('hintsFor：命中常用邮箱才给提示，没命中就空', () => {
  assert.equal(hintsFor('imap.gmail.com').length, 1)
  assert.ok(hintsFor('imap.gmail.com')[0].includes('应用专用密码'))
  assert.deepEqual(hintsFor('imap.example.com'), [])
})

test('securityLabel：三种加密方式的中文名', () => {
  assert.equal(securityLabel('ssl'), 'SSL/TLS')
  assert.equal(securityLabel('starttls'), 'STARTTLS')
  assert.equal(securityLabel('none'), '不加密（仅本机调试）')
  assert.equal(securityLabel('whatever'), '不加密（仅本机调试）')
})

test('PRESETS：三个常用邮箱，host 都是 imap.*', () => {
  assert.equal(PRESETS.length, 3)
  for (const p of PRESETS) {
    assert.ok(p.host.startsWith('imap.'))
    assert.ok(p.hint.length > 0)
  }
})
