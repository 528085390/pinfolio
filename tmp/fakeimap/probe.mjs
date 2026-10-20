import hoodiecrow from 'hoodiecrow-imap'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'

function rawMail(n, opts = {}) {
  const subj = opts.subject || ('测试邮件 ' + n)
  return [
    'From: =?UTF-8?B?' + Buffer.from('发件人' + n).toString('base64') + '?= <sender' + n + '@example.com>',
    'To: me@example.com',
    'Subject: =?UTF-8?B?' + Buffer.from(subj).toString('base64') + '?=',
    'Date: ' + new Date(Date.now() - n * 3600000).toUTCString(),
    'Message-ID: <msg' + n + '@example.com>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="B' + n + '"',
    '',
    '--B' + n,
    'Content-Type: multipart/alternative; boundary="A' + n + '"',
    '',
    '--A' + n,
    'Content-Type: text/plain; charset=utf-8',
    '',
    '纯文本正文 ' + n,
    '--A' + n,
    'Content-Type: text/html; charset=utf-8',
    '',
    '<html><body><p>HTML 正文 ' + n + '</p><img src="https://track.example.com/p.gif"></body></html>',
    '--A' + n + '--',
    '--B' + n,
    'Content-Type: application/octet-stream; name="file' + n + '.bin"',
    'Content-Disposition: attachment; filename="file' + n + '.bin"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('hello attachment ' + n).toString('base64'),
    '--B' + n + '--',
    '',
  ].join('\r\n')
}

const server = hoodiecrow({
  plugins: ['ID', 'NAMESPACE', 'SPECIAL-USE', 'LIST-EXTENDED', 'UIDPLUS', 'ESEARCH', 'SASL-IR', 'AUTH-PLAIN', 'LITERAL+', 'ENABLE'],
  id: { name: 'hoodiecrow', version: '3.3.1' },
  storage: {
    INBOX: { messages: [1, 2, 3].map((n) => ({ raw: rawMail(n) })) },
    'Sent Items': { messages: [{ raw: rawMail(9, { subject: '已发送' }) }], 'special-use': '\\Sent' },
  },
})
await new Promise((res) => server.listen(0, res))
const port = server.address().port
console.log('fake imap on', port)

const client = new ImapFlow({
  host: '127.0.0.1', port, secure: false,
  auth: { user: 'testuser', pass: 'testpass' },
  logger: false, disableAutoIdle: true,
})
await client.connect()
console.log('connected; serverInfo', JSON.stringify(client.serverInfo))
console.log('capabilities', [...client.capabilities.keys()].slice(0, 30).join(','))
console.log('list', (await client.list()).map((m) => m.path + '|' + (m.specialUse || '')))
const lock = await client.getMailboxLock('INBOX')
try {
  const uids = await client.search({ all: true }, { uid: true })
  console.log('search all uids', uids)
  const desc = [...uids].sort((a, b) => b - a)
  for await (const msg of client.fetch(desc.slice(0, 2), { uid: true, envelope: true, flags: true, internalDate: true, size: true }, { uid: true })) {
    console.log('env', msg.uid, msg.envelope.subject, msg.envelope.from?.[0]?.address, msg.flags, msg.internalDate)
  }
  const one = await client.fetchOne(String(desc[0]), { uid: true, source: true }, { uid: true })
  console.log('source bytes', one.source.length)
  const parsed = await simpleParser(one.source)
  console.log('parsed', parsed.subject, parsed.from?.value?.[0]?.address, 'html?', !!parsed.html, 'att', parsed.attachments.map((a) => a.filename + ':' + a.size))
  const st = await client.status('INBOX', { messages: true, unseen: true })
  console.log('status', JSON.stringify(st))
} finally { lock.release() }
await client.logout()
server.close(() => process.exit(0))
