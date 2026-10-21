import { createRequire } from "node:module"
const require = createRequire(process.cwd() + "/package.json")
const { ImapFlow } = require("imapflow")
import { startFakeImap, makeRaw } from "./server.mjs"
const fake = await startFakeImap(3)
const c = new ImapFlow({ host: "127.0.0.1", port: fake.port, secure: false, auth: { user: "testuser", pass: "testpass" }, logger: false, disableAutoIdle: true })
await c.connect()
try {
  const raw = makeRaw({ n: 999, subject: "自动刷新测试信", date: new Date() })
  await c.append("INBOX", raw, ["\\Seen"])
  const box = await c.mailboxOpen("INBOX")
  console.log("append ok, exists =", box.exists)
  for await (const m of c.fetch({ seq: String(box.exists) }, { envelope: true }, { uid: true })) {
    console.log("last subject =", m.envelope?.subject)
  }
} catch (e) {
  console.log("APPEND FAILED:", e.message)
} finally {
  await c.logout().catch(() => {})
  await fake.close()
}
