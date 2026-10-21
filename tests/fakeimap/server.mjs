import hoodiecrow from 'hoodiecrow-imap'

const B64 = (s) => '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?='

function qpEncode(s) {
  const bytes = Buffer.from(s, 'utf8')
  let out = ''
  let lineLen = 0
  for (const byte of bytes) {
    if (byte === 0x0a) { out += '\r\n'; lineLen = 0; continue }
    if (byte === 0x0d) continue
    let token
    if ((byte >= 33 && byte <= 126 && byte !== 61) || byte === 32) token = String.fromCharCode(byte)
    else token = '=' + byte.toString(16).toUpperCase().padStart(2, '0')
    if (lineLen + token.length > 72) { out += '=\r\n'; lineLen = 0 }
    out += token
    lineLen += token.length
  }
  return out
}

export function makeRaw({ n, subject, fromName, fromAddr, to, date, text, html, attachment, seen = false }) {
  const b = 'B' + n
  const a = 'A' + n
  const head = [
    'From: ' + B64(fromName || ('发件人' + n)) + ' <' + (fromAddr || 'sender' + n + '@example.com') + '>',
    'To: ' + (to || 'me@example.com'),
    'Subject: ' + B64(subject || ('测试邮件 ' + n)),
    'Date: ' + new Date(date).toUTCString(),
    'Message-ID: <msg' + n + '@example.com>',
    'MIME-Version: 1.0',
  ]
  const lines = []
  if (attachment) {
    head.push('Content-Type: multipart/mixed; boundary="' + b + '"', '')
    lines.push('--' + b, 'Content-Type: multipart/alternative; boundary="' + a + '"', '')
  } else {
    head.push('Content-Type: multipart/alternative; boundary="' + a + '"', '')
  }
  lines.push('--' + a, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '', qpEncode(text || ('正文 ' + n)))
  lines.push('--' + a, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(html || ('<p>HTML 正文 ' + n + '</p>'), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'))
  lines.push('--' + a + '--')
  if (attachment) {
    lines.push(
      '--' + b,
      'Content-Type: ' + (attachment.type || 'application/octet-stream') + '; name="' + attachment.name + '"',
      'Content-Disposition: attachment; filename="' + attachment.name + '"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(attachment.data, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
    )
    lines.push('--' + b + '--')
  }
  return head.join('\r\n') + '\r\n' + lines.join('\r\n') + '\r\n'
}

export function buildStorage(count = 120) {
  const now = Date.now()
  const messages = []
  for (let i = 1; i <= count; i++) {
    // 让 UID 越大时间越新（真实 IMAP 就是这样：新邮件 UID 更大）
    const date = new Date(now - (count - i + 1) * 3600_000)
    const opts = {
      n: i,
      subject: '第 ' + i + ' 封邮件',
      fromName: '发件人' + i,
      fromAddr: 'sender' + i + '@example.com',
      date,
      text: '这是第 ' + i + ' 封邮件的纯文本正文，用来验证列表摘要。第二行内容 ' + i + '。',
      html: '<html><body><p>这是第 ' + i + ' 封邮件</p><img src="https://track.example.com/p' + i + '.gif" alt="tracker"></body></html>',
      seen: i % 5 === 0,
    }
    if (i === count) {
      opts.attachment = { name: '报告.txt', type: 'text/plain', data: 'attachment body 1' }
      opts.html = '<html><body><p>带附件的邮件</p><img src="https://track.example.com/p.gif"></body></html>'
    }
    messages.push({ raw: makeRaw(opts), internaldate: date, flags: opts.seen ? ['\\Seen'] : [] })
  }
  return {
    INBOX: { messages },
    '': {
      separator: '/',
      folders: {
        'Sent Items': {
          messages: [{ raw: makeRaw({ n: 900, subject: '已发送的邮件', date: new Date(now - 100 * 3600_000) }), internaldate: new Date(now - 100 * 3600_000) }],
          'special-use': '\\Sent',
        },
        Trash: {
          messages: [{ raw: makeRaw({ n: 901, subject: '垃圾箱邮件', date: new Date(now - 200 * 3600_000) }), internaldate: new Date(now - 200 * 3600_000) }],
          'special-use': '\\Trash',
        },
      },
    },
  }
}

export const PLUGINS = ['ID', 'NAMESPACE', 'SPECIAL-USE', 'LIST-EXTENDED', 'UIDPLUS', 'ESEARCH', 'SASL-IR', 'AUTH-PLAIN', 'LITERAL+', 'ENABLE']

export async function startFakeImap(count = 120) {
  const server = hoodiecrow({
    plugins: PLUGINS,
    id: { name: 'hoodiecrow', version: '3.3.1' },
    storage: buildStorage(count),
  })
  await new Promise((res) => server.listen(0, res))
  return { server, port: server.address().port, close: () => new Promise((res) => server.close(res)) }
}
