import hoodiecrow from 'hoodiecrow-imap'
import { ImapFlow } from 'imapflow'

const raw = (n) => [
  'From: A' + n + ' <a' + n + '@example.com>',
  'To: me@example.com',
  'Subject: subj' + n,
  'Date: ' + new Date(Date.now() - n * 3600000).toUTCString(),
  'Message-ID: <m' + n + '@x>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="BB' + n + '"',
  '',
  '--BB' + n,
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Hello ' + n + ' =E4=B8=AD=E6=96=87 snippet line1',
  'line2 of body ' + n,
  '--BB' + n,
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>html ' + n + '</p>',
  '--BB' + n + '--',
  '',
].join('\r\n')

const server = hoodiecrow({
  plugins: ['ID', 'NAMESPACE', 'SPECIAL-USE', 'LIST-EXTENDED', 'UIDPLUS', 'ESEARCH', 'ENABLE'],
  storage: {
    INBOX: { messages: [1, 2, 3].map((n) => ({ raw: raw(n), internaldate: new Date(Date.now() - n * 3600000) })) },
    '': { separator: '/', folders: { 'Sent Items': { messages: [] }, Trash: { messages: [] } } },
  },
})
await new Promise((res) => server.listen(0, res))
const client = new ImapFlow({ host: '127.0.0.1', port: server.address().port, secure: false, auth: { user: 'testuser', pass: 'testpass' }, logger: false, disableAutoIdle: true })
await client.connect()
const lock = await client.getMailboxLock('INBOX')
try {
  const uids = await client.search({ all: true }, { uid: true })
  console.log('uids', uids)
  const unseen = await client.search({ seen: false }, { uid: true })
  console.log('unseen', unseen)
  for await (const m of client.fetch(uids, { uid: true, envelope: true, flags: true, internalDate: true, size: true, bodyParts: [{ key: 'TEXT', maxLength: 300 }] }, { uid: true })) {
    console.log('uid', m.uid, 'date', m.internalDate, 'flags', [...(m.flags || [])], 'parts', m.bodyParts ? [...m.bodyParts.keys()] : null)
    const buf = m.bodyParts?.get('TEXT')
    console.log('   TEXT:', JSON.stringify(buf ? buf.toString('utf8').slice(0, 200) : null))
  }
  const hdr = await client.fetchOne(String(uids[0]), { uid: true, headers: ['content-type', 'subject'] }, { uid: true })
  console.log('headers buf:', JSON.stringify(hdr.headers ? hdr.headers.toString('utf8') : null))
} finally { lock.release() }
await client.logout()
await new Promise((r) => server.close(r))
