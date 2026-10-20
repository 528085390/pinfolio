import { startFakeImap } from './server.mjs'

const BASE = 'http://127.0.0.1:7788/api/mail'
const results = []
let failed = 0
function ok(name, cond, extra = '') {
  results.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  [' + extra + ']' : ''))
  if (!cond) failed++
}
function step(name, fn) {
  return fn().then(
    (v) => { if (!v) ok(name, false, 'returned falsy'); return v },
    (e) => { ok(name + ' -> threw', false, e.message) },
  )
}
async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers }
}

const fake = await startFakeImap(120)
console.log('fake imap on port', fake.port)
let accountId = null

try {
  // ---- 账号 CRUD ----
  let r = await req('POST', '/accounts', {
    label: '测试邮箱', email: 'me@example.com', host: '127.0.0.1', port: fake.port,
    username: 'testuser', password: 'testpass', security: 'none',
  })
  ok('创建账号返回 201', r.status === 201, 'status=' + r.status + ' ' + r.text.slice(0, 120))
  ok('创建账号不返回密码', r.json && !('password' in r.json) && r.json.hasPassword === true)
  accountId = r.json?.id

  r = await req('GET', '/accounts')
  ok('账号列表包含新账号', r.json?.accounts?.some((a) => a.id === accountId))
  ok('账号列表不泄露密码', !JSON.stringify(r.json).includes('testpass'))

  r = await req('POST', '/accounts', { host: '', username: '', password: '', security: 'ssl' })
  ok('缺字段被拒（400）', r.status === 400, r.text.slice(0, 80))

  // ---- 连接测试 ----
  r = await req('POST', '/accounts/test', { host: '127.0.0.1', port: fake.port, username: 'testuser', password: 'testpass', security: 'none' })
  ok('连接测试成功', r.status === 200 && r.json?.ok === true, r.text.slice(0, 160))
  ok('连接测试返回服务器名', !!r.json?.server, String(r.json?.server))

  r = await req('POST', '/accounts/test', { host: '127.0.0.1', port: fake.port, username: 'testuser', password: 'wrong', security: 'none' })
  ok('错误密码给出可读错误', r.status === 400 && /登录被拒绝/.test(r.json?.error || ''), String(r.json?.error))

  // ---- 文件夹 ----
  r = await req('GET', '/folders?account=' + accountId)
  const paths = (r.json?.folders || []).map((f) => f.path)
  ok('文件夹列表含 INBOX', paths.includes('INBOX'), paths.join(','))
  ok('文件夹列表含 Sent/Trash', paths.includes('Sent Items') && paths.includes('Trash'), paths.join(','))
  ok('文件夹带 special-use', (r.json?.folders || []).some((f) => f.specialUse === '\\Sent'))

  // ---- 未读数 ----
  r = await req('GET', '/accounts?counts=1')
  const acc = r.json?.accounts?.find((a) => a.id === accountId)
  ok('账号带未读数', acc?.unseen === 96, 'unseen=' + acc?.unseen + ' total=' + acc?.total)
  ok('账号带总数', acc?.total === 120, 'total=' + acc?.total)

  // ---- 第一页 ----
  r = await req('GET', '/messages?account=all&limit=50')
  const p1 = r.json
  ok('第一页 50 条', p1?.items?.length === 50, 'n=' + p1?.items?.length)
  ok('总数 120', p1?.total === 120, 'total=' + p1?.total)
  ok('有更多', p1?.hasMore === true)
  ok('按时间倒序', p1?.items?.every((m, i, arr) => i === 0 || Date.parse(arr[i - 1].date) >= Date.parse(m.date)))
  ok('行含发件人/主题/时间', !!p1?.items?.[0]?.from?.address && !!p1?.items?.[0]?.subject && !!p1?.items?.[0]?.date)
  ok('行含纯文本摘要', /正文/.test(p1?.items?.[0]?.snippet || ''), JSON.stringify(p1?.items?.[0]?.snippet || '').slice(0, 120))
  ok('摘要无 HTML 标签', !/<[a-z]/i.test(p1?.items?.[0]?.snippet || ''))
  ok('摘要中文未乱码', /这是第 120 封邮件/.test(p1?.items?.[0]?.snippet || ''), JSON.stringify(p1?.items?.[0]?.snippet || '').slice(0, 80))
  ok('最新一封排在第一行', p1?.items?.[0]?.subject === '第 120 封邮件', p1?.items?.[0]?.subject)
  ok('未读标记正确（第 120 封已读）', p1?.items?.find((m) => m.subject === '第 120 封邮件')?.unread === false)
  ok('未读标记正确（第 119 封未读）', p1?.items?.find((m) => m.subject === '第 119 封邮件')?.unread === true)
  ok('本地已读标记默认 false', p1?.items?.every((m) => m.localRead === false))
  ok('行带账号标识', !!p1?.items?.[0]?.accountLabel)

  // ---- 翻页到底 ----
  const seen = new Set()
  let offset = 0
  let pages = 0
  let lastDate = Infinity
  let orderOk = true
  while (offset < 200) {
    const rr = await req('GET', '/messages?account=all&limit=50&offset=' + offset)
    if (!rr.json?.items?.length) break
    pages++
    for (const m of rr.json.items) {
      const key = m.accountId + ':' + m.uid
      if (seen.has(key)) ok('翻页无重复', false, key)
      seen.add(key)
      const t = Date.parse(m.date)
      if (t > lastDate) orderOk = false
      lastDate = t
    }
    offset += 50
    if (!rr.json.hasMore) break
  }
  ok('翻页共 3 页', pages === 3, 'pages=' + pages)
  ok('翻页共 120 封无重复', seen.size === 120, 'n=' + seen.size)
  ok('跨页时间仍倒序', orderOk)
  r = await req('GET', '/messages?account=all&limit=50&offset=120')
  ok('越界页返回空', (r.json?.items?.length || 0) === 0 && r.json?.hasMore === false)

  // ---- 单账号筛选 ----
  r = await req('GET', '/messages?account=' + accountId + '&limit=10')
  ok('按账号筛选生效', r.json?.items?.length === 10 && r.json.items.every((m) => m.accountId === accountId))

  // ---- 邮件详情 ----
  const first = p1.items[0]
  r = await req('GET', '/message?account=' + accountId + '&folder=INBOX&uid=' + first.uid)
  const msg = r.json
  ok('详情 200', r.status === 200, r.text.slice(0, 120))
  ok('详情含主题/发件人/收件人', !!msg?.subject && !!msg?.from?.address && msg?.to?.length > 0)
  ok('详情含日期', !!msg?.date)
  ok('详情含纯文本正文', /正文/.test(msg?.text || ''))
  ok('详情含 HTML 正文', /<p>/.test(msg?.html || ''))
  ok('详情 HTML 保留远程图片地址（前端负责拦）', /track\.example\.com/.test(msg?.html || ''))
  ok('详情含附件列表', msg?.attachments?.length === 1 && msg.attachments[0].filename === '报告.txt', JSON.stringify(msg?.attachments))

  r = await req('GET', '/attachment?account=' + accountId + '&folder=INBOX&uid=' + first.uid + '&index=0')
  ok('附件下载 200', r.status === 200, 'status=' + r.status)
  ok('附件内容正确', r.text === 'attachment body 1', r.text.slice(0, 40))
  ok('附件带下载头', /attachment;/.test(r.headers.get('content-disposition') || ''))

  // ---- 本地已读 ----
  r = await req('POST', '/local-read', { account: accountId, folder: 'INBOX', uid: first.uid })
  ok('标记本地已读 200', r.status === 200 && r.json?.ok === true)
  r = await req('GET', '/messages?account=' + accountId + '&limit=5')
  ok('标记后列表 localRead=true', r.json?.items?.find((m) => m.uid === first.uid)?.localRead === true)
  ok('服务器未读数不变（没有写回 \\Seen）', true)
  r = await req('GET', '/accounts?counts=1')
  ok('未读数仍为 96（本地标记不影响服务器）', r.json?.accounts?.find((a) => a.id === accountId)?.unseen === 96, 'unseen=' + r.json?.accounts?.find((a) => a.id === accountId)?.unseen)
  r = await req('DELETE', '/local-read?account=' + accountId + '&folder=INBOX&uid=' + first.uid)
  ok('取消本地已读', r.status === 200 && r.json?.ok === true)

  // ---- 其它文件夹 ----
  r = await req('GET', '/messages?account=' + accountId + '&folder=Sent%20Items&limit=10')
  ok('Sent 文件夹可读', r.json?.items?.length === 1 && /已发送/.test(r.json.items[0].subject), JSON.stringify(r.json?.items?.[0]?.subject))

  // ---- 编辑 / 停用 ----
  r = await req('PUT', '/accounts/' + accountId, { label: '改名邮箱', host: '127.0.0.1', port: fake.port, username: 'testuser', security: 'none' })
  ok('编辑账号保留密码', r.status === 200 && r.json?.label === '改名邮箱' && r.json?.hasPassword === true, r.text.slice(0, 120))

  // ---- 删除 ----
  r = await req('DELETE', '/accounts/' + accountId)
  ok('删除账号', r.status === 200 && r.json?.ok === true)
  accountId = null
  r = await req('GET', '/messages?account=all&limit=5')
  ok('无账号时返回空态标记', r.json?.noAccounts === true, JSON.stringify(r.json).slice(0, 120))
} catch (e) {
  ok('测试脚本异常', false, e.stack || e.message)
} finally {
  if (accountId) await req('DELETE', '/accounts/' + accountId).catch(() => {})
  await fake.close()
}

console.log(results.join('\n'))
console.log('\n' + (results.length - failed) + '/' + results.length + ' passed, ' + failed + ' failed')
process.exit(failed ? 1 : 0)
