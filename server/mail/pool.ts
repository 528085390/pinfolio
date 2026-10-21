// IMAP 连接池：按账号缓存 ImapFlow 连接；账号密码/加密方式/代理变了就重建。
// 只提供连接，不碰业务；所有取信操作都由 client.ts 通过 withMailbox 走只读锁。
import { ImapFlow } from 'imapflow'
import type { MailAccountRow } from './store.js'
import { proxyOf } from './errors.js'

export const OP_TIMEOUT = 20_000

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + '超时（' + Math.round(ms / 1000) + ' 秒）')), ms)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

export function isEncrypted(client: ImapFlow): boolean {
  const socket = (client as any).socket
  return !!(socket && socket.encrypted)
}

// ---------- 连接池 ----------

type PoolEntry = { client: ImapFlow; sig: string }
const pool = new Map<number, PoolEntry>()

function sigOf(a: MailAccountRow): string {
  return [a.host, a.port, a.username, a.password, a.security, a.proxy].join('\u0000')
}

export function makeClient(a: Pick<MailAccountRow, 'host' | 'port' | 'username' | 'password' | 'security'> & { proxy?: string }): ImapFlow {
  const proxy = proxyOf(a)
  return new ImapFlow({
    host: a.host,
    port: Number(a.port) || 993,
    secure: a.security === 'ssl',
    // imapflow 原生支持代理（http/https 走 CONNECT，socks/socks5/socks4/socks4a 走 SOCKS）
    ...(proxy ? { proxy } : {}),
    auth: { user: a.username, pass: a.password },
    clientInfo: { name: 'pinboard', version: '0.1.0', vendor: 'pinboard' },
    disableAutoIdle: true,
    connectionTimeout: OP_TIMEOUT,
    greetingTimeout: 15_000,
    socketTimeout: 120_000,
    logger: false,
  } as any)
}

export function dropConnection(accountId: number) {
  const entry = pool.get(accountId)
  if (!entry) return
  pool.delete(accountId)
  try { entry.client.close() } catch { /* ignore */ }
}

export function dropAllConnections() {
  for (const id of [...pool.keys()]) dropConnection(id)
}

export async function getClient(a: MailAccountRow): Promise<ImapFlow> {
  const sig = sigOf(a)
  const entry = pool.get(a.id)
  if (entry && (entry.sig !== sig || !entry.client.usable)) dropConnection(a.id)
  const alive = pool.get(a.id)
  if (alive) return alive.client
  const client = makeClient(a)
  client.on('error', (err: any) => {
    console.warn('[mail] 连接错误 account=' + a.id + ' ' + (err?.message || err))
    const cur = pool.get(a.id)
    if (cur && cur.client === client) pool.delete(a.id)
  })
  client.on('close', () => {
    const cur = pool.get(a.id)
    if (cur && cur.client === client) pool.delete(a.id)
  })
  await withTimeout(client.connect(), OP_TIMEOUT, '连接 IMAP 服务器')
  if (a.security === 'starttls' && !isEncrypted(client)) {
    try { client.close() } catch { /* ignore */ }
    throw new Error('服务器不支持 STARTTLS，已中止连接（避免用明文发送密码），请改用 SSL/TLS')
  }
  pool.set(a.id, { client, sig })
  return client
}

export async function withMailbox<T>(a: MailAccountRow, folder: string, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = await getClient(a)
  const lock = await withTimeout(client.getMailboxLock(folder, { readOnly: true } as any), OP_TIMEOUT, '打开文件夹 ' + folder)
  try {
    return await withTimeout(fn(client), OP_TIMEOUT, '读取邮件')
  } finally {
    try { lock.release() } catch { /* ignore */ }
  }
}
