// 观测台快捷入口卡的解析（server/kuma/quick.ts）
// 运行：pnpm test:unit
import test from 'node:test'
import assert from 'node:assert/strict'
import { QUICK_NAME_MAX, QUICK_NOTE_MAX, hostOf, isHttpUrl, parseQuick } from '../../server/kuma/quick.js'

test('parseQuick：不是数组就给空数组（文件写坏了当没配置）', () => {
  assert.deepEqual(parseQuick(null), [])
  assert.deepEqual(parseQuick({ url: 'http://a' }), [])
  assert.deepEqual(parseQuick('http://a'), [])
})

test('parseQuick：坏条目跳过、好条目保留', () => {
  const out = parseQuick([
    null,
    'http://nope',
    42,
    { name: '缺 url' },
    { url: 123 },
    { name: 'javascript', url: 'javascript:alert(1)' },
    { name: '相对路径', url: '/photos' },
    { name: 'ftp', url: 'ftp://host/x' },
    { name: '好的', url: 'http://127.0.0.1:2283' },
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].name, '好的')
  assert.equal(out[0].url, 'http://127.0.0.1:2283')
})

test('parseQuick：note / label / icon 的默认值', () => {
  const [a] = parseQuick([{ name: '图库', url: 'https://photos.example.com' }])
  assert.deepEqual(a, { name: '图库', url: 'https://photos.example.com', note: '', label: '图库', icon: '' })
})

test('parseQuick：name 留空退回 host（带端口），host 也拿不到就丢掉', () => {
  const [a] = parseQuick([{ url: 'http://203.0.113.11:2283' }])
  assert.equal(a.name, '203.0.113.11:2283')
  assert.equal(a.label, '203.0.113.11:2283')
  assert.deepEqual(parseQuick([{ url: 'http://' }]), [])
})

test('parseQuick：同一 URL 只留第一条（写重了不出两张一样的卡）', () => {
  const out = parseQuick([
    { name: '第一次', url: 'http://a.example/x' },
    { name: '第二次', url: 'http://a.example/x' },
    { name: '另一个', url: 'http://a.example/y' },
  ])
  assert.deepEqual(out.map((q) => q.name), ['第一次', '另一个'])
})

test('parseQuick：去首尾空白并截断超长字段', () => {
  const longName = 'A'.repeat(QUICK_NAME_MAX + 10)
  const longNote = 'B'.repeat(QUICK_NOTE_MAX + 10)
  const [a] = parseQuick([{ name: '  ' + longName + '  ', url: '  http://x.example  ', note: ' ' + longNote, label: '  说明  ' }])
  assert.equal(a.name.length, QUICK_NAME_MAX)
  assert.equal(a.note.length, QUICK_NOTE_MAX)
  assert.equal(a.url, 'http://x.example')
  assert.equal(a.label, '说明')
})

test('isHttpUrl：只认 http(s) 绝对地址', () => {
  assert.equal(isHttpUrl('http://a'), true)
  assert.equal(isHttpUrl('HTTPS://A/x'), true)
  assert.equal(isHttpUrl('http://'), false)
  assert.equal(isHttpUrl('//a.example'), false)
  assert.equal(isHttpUrl('javascript:alert(1)'), false)
  assert.equal(isHttpUrl('data:text/html,x'), false)
  assert.equal(isHttpUrl('http://a b'), false)
})

test('hostOf：解析不出来回空串，不抛', () => {
  assert.equal(hostOf('http://1.2.3.4:2283/x'), '1.2.3.4:2283')
  assert.equal(hostOf('不是网址'), '')
})
