// 邮件解析纯函数：snippetFromText 是列表页摘要的唯一来源，它出错的表现是
// 「列表里每行都显示一坨 HTML」或者「摘要里冒出 [image: xxx]」——这里把各种真实邮件形状钉住。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addrList, addrOne, snippetFromText, toIso } from '../../server/mail/parse.js'

const part = (headers: string, body: string) => '--B\n' + headers + '\n\n' + body + '\n--B--\n'

test('snippetFromText：没有正文时返回空串', () => {
  assert.equal(snippetFromText(undefined), '')
  assert.equal(snippetFromText(Buffer.alloc(0)), '')
})

test('snippetFromText：multipart 优先取 text/plain，不取 html 分支', () => {
  const raw =
    part('Content-Type: text/plain; charset="utf-8"\nContent-Transfer-Encoding: 7bit', '纯文本正文') +
    part('Content-Type: text/html; charset="utf-8"', '<p>HTML 正文</p>')
  const s = snippetFromText(Buffer.from(raw))
  assert.equal(s, '纯文本正文')
})

test('snippetFromText：quoted-printable 的 =XX 与软换行都解开', () => {
  const raw = part(
    'Content-Type: text/plain; charset="utf-8"\nContent-Transfer-Encoding: quoted-printable',
    '=E4=BD=A0=E5=A5=BD soft=\nwrap',
  )
  const s = snippetFromText(Buffer.from(raw))
  assert.ok(s.includes('你好'), '中文应解出，实际：' + s)
  assert.ok(s.includes('softwrap'), '软换行应拼回去，实际：' + s)
  assert.ok(!s.includes('=E4'), '不应残留 =XX，实际：' + s)
})

test('snippetFromText：base64 分支能解', () => {
  const raw = part('Content-Type: text/plain; charset="utf-8"\nContent-Transfer-Encoding: base64', 'aGVsbG8gd29ybGQ=')
  assert.equal(snippetFromText(Buffer.from(raw)), 'hello world')
})

test('snippetFromText：只有 html 分支时剥标签、解实体', () => {
  const raw = part('Content-Type: text/html; charset="utf-8"', '<p>Hello&nbsp;<b>World</b></p><br><img src="x.png">')
  assert.equal(snippetFromText(Buffer.from(raw)), 'Hello World')
})

test('snippetFromText：非 multipart 的整封 html 也剥标签', () => {
  const s = snippetFromText(Buffer.from('<html><body><p>只有 HTML</p></body></html>'))
  assert.equal(s, '只有 HTML')
})

test('snippetFromText：清掉 [image: x] / [cid:x] 占位符', () => {
  const s = snippetFromText(Buffer.from('开头 [image: logo.png] 中间 [cid:abc123] 结尾'))
  assert.equal(s, '开头 中间 结尾')
})

test('snippetFromText：清掉零宽字符与组合字形连接符', () => {
  const s = snippetFromText(Buffer.from('a\u200bb\u034fc\u00ad'))
  assert.equal(s, 'abc')
})

test('snippetFromText：Outlook 条件注释被吃掉（含被 maxLength 截断的半截注释）', () => {
  // 注释是被替换成一个空格（不是删掉），所以前后会留一个空格 —— 实测行为，别改成猜的
  const ok = snippetFromText(Buffer.from('前<!--[if mso]><xml>-->后'))
  assert.equal(ok, '前 后')
  const truncated = snippetFromText(Buffer.from('前<!--[if mso]><xml> 没闭合'))
  assert.equal(truncated, '前')
})

test('snippetFromText：摘要最多 240 字', () => {
  const s = snippetFromText(Buffer.from('x'.repeat(400)))
  assert.equal(s.length, 240)
})

test('addrList：兼容 mailparser 的 {value:[…]}、裸数组、单对象', () => {
  assert.deepEqual(addrList({ value: [{ name: '张三', address: 'z@x.com' }, { address: '' }] }), [
    { name: '张三', address: 'z@x.com' },
  ])
  assert.deepEqual(addrList([{ address: 'b@y.com' }]), [{ name: '', address: 'b@y.com' }])
  assert.deepEqual(addrList({ name: '单人', address: 'c@z.com' }), [{ name: '单人', address: 'c@z.com' }])
  assert.deepEqual(addrList(null), [])
  assert.deepEqual(addrList(undefined), [])
})

test('addrOne：取第一个，空列表回 null', () => {
  assert.deepEqual(addrOne([{ address: 'a@b.com' }, { address: 'c@d.com' }]), { name: '', address: 'a@b.com' })
  assert.equal(addrOne([]), null)
  assert.equal(addrOne(null), null)
})

test('toIso：Date / 字符串 / 空 / 垃圾值', () => {
  assert.equal(toIso(new Date('2026-10-21T00:00:00Z')), '2026-10-21T00:00:00.000Z')
  assert.equal(toIso('2026-10-21'), '2026-10-21T00:00:00.000Z')
  assert.equal(toIso(null), null)
  assert.equal(toIso(''), null)
  assert.equal(toIso('not a date'), null)
})
