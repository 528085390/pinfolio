import hoodiecrow from 'hoodiecrow-imap'
import { ImapFlow } from 'imapflow'

const shapes = {
  flat: { INBOX: { messages: [] }, 'Sent Items': { messages: [] } },
  rooted: { INBOX: { messages: [] }, '': { separator: '/', folders: { 'Sent Items': {}, Trash: {} } } },
  dotted: { INBOX: { messages: [] }, 'INBOX.Sent': { messages: [] } },
}
for (const [name, storage] of Object.entries(shapes)) {
  const server = hoodiecrow({ plugins: ['ID', 'NAMESPACE', 'SPECIAL-USE', 'LIST-EXTENDED', 'ENABLE'], storage })
  await new Promise((res) => server.listen(0, res))
  const client = new ImapFlow({ host: '127.0.0.1', port: server.address().port, secure: false, auth: { user: 'testuser', pass: 'testpass' }, logger: false, disableAutoIdle: true })
  await client.connect()
  try {
    console.log(name, 'list ->', (await client.list()).map((m) => m.path + ' | delim=' + m.delimiter + ' | ' + (m.specialUse || '')))
    const raw = await client.exec('LIST', '""', '"*"', { untagged: { LIST: async (u) => { console.log(name, 'raw LIST', JSON.stringify(u)) } } })
    console.log(name, 'raw exec ok', !!raw)
  } catch (e) { console.log(name, 'ERR', e.message) }
  await client.logout().catch(() => {})
  await new Promise((res) => server.close(res))
}
