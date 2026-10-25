import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { encryptText, isEncrypted } from './crypto.js'

// 懒迁移：把已经躺在明文里的凭据就地加密。幂等——跑多少次结果都一样，
// 已经带 enc:v1: 的直接跳过，不会二次加密。
//
// 覆盖三处（见 spec 03）：
//   mail_accounts.password   库里明文列
//   data/kuma-pass.txt       Kuma 口令（同时写一份进 settings.kuma_pass）
//   data/metrics.json 的 base 含采集 token 的地址

export type SecretMigration = { mail: number; kuma: number; metrics: number }

function hasSettings(db: DatabaseSync): boolean {
  try {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get()
    return !!row
  } catch {
    return false
  }
}

/** 邮箱密码：非空且没加密的逐条加密，返回改了几条。 */
export function migrateMailPasswords(db: DatabaseSync, key: Buffer): number {
  const rows = db.prepare("SELECT id, password FROM mail_accounts WHERE password IS NOT NULL AND password <> ''").all() as any[]
  const upd = db.prepare('UPDATE mail_accounts SET password = ? WHERE id = ?')
  let n = 0
  for (const row of rows) {
    if (isEncrypted(row.password)) continue
    upd.run(encryptText(String(row.password), key), row.id)
    n++
  }
  return n
}

/** Kuma 口令：文件内容换成密文，并尽量同步进 settings.kuma_pass。 */
export function migrateKumaPass(db: DatabaseSync, key: Buffer, dataDir: string): number {
  const file = join(dataDir, 'kuma-pass.txt')
  if (!existsSync(file)) return 0
  const raw = readFileSync(file, 'utf8').trim()
  if (!raw) return 0
  const enc = isEncrypted(raw) ? raw : encryptText(raw, key)
  if (enc !== raw) writeFileSync(file, enc + '\n', 'utf8')
  if (hasSettings(db)) {
    const existing = db.prepare("SELECT value FROM settings WHERE key = 'kuma_pass'").get() as any
    if (!existing) {
      db.prepare("INSERT INTO settings (key, value) VALUES ('kuma_pass', ?)").run(enc)
    }
  }
  return enc === raw ? 0 : 1
}

/** metrics.json 的 base：只换 base，hosts 与其它未知键原样保留（先写临时文件再 rename）。 */
export function migrateMetricsBase(key: Buffer, dataDir: string): number {
  const file = join(dataDir, 'metrics.json')
  if (!existsSync(file)) return 0
  let json: any
  try {
    json = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return 0
  }
  const base = typeof json?.base === 'string' ? json.base.trim() : ''
  if (!base || isEncrypted(base)) return 0
  json.base = encryptText(base, key)
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(json, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
  return 1
}

/** 一次性跑完三处，返回各自改了几条。 */
export function migrateSecrets(db: DatabaseSync, key: Buffer, dataDir: string): SecretMigration {
  return {
    mail: migrateMailPasswords(db, key),
    kuma: migrateKumaPass(db, key, dataDir),
    metrics: migrateMetricsBase(key, dataDir),
  }
}
