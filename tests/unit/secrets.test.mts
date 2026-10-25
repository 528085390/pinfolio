import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  deriveKey, encryptText, decryptText, isEncrypted, readSecret, parseSecret, generateSecret,
} from '../../server/secrets/crypto.js'
import { migrateSecrets } from '../../server/secrets/migrate.js'

const KEY = deriveKey(generateSecret())

test('加解密往返：密文带 enc:v1: 前缀，能解回原文', () => {
  const plain = 'wuva stuw abcd efgh'
  const enc = encryptText(plain, KEY)
  assert.match(enc, /^enc:v1:/)
  assert.equal(enc.split(':').length, 5)
  assert.equal(decryptText(enc, KEY), plain)
})

test('每次加密 IV 不同：同一明文两次结果不一样', () => {
  const a = encryptText('same', KEY)
  const b = encryptText('same', KEY)
  assert.notEqual(a, b)
  assert.equal(decryptText(a, KEY), 'same')
  assert.equal(decryptText(b, KEY), 'same')
})

test('换密钥解不开：抛错而不是返回乱码', () => {
  const enc = encryptText('secret', KEY)
  const other = deriveKey(generateSecret())
  assert.throws(() => decryptText(enc, other))
})

test('密文被篡改：抛错', () => {
  const enc = encryptText('secret', KEY)
  const parts = enc.split(':')
  const raw = Buffer.from(parts[4], 'base64')
  raw[0] = raw[0] ^ 0xff
  const tampered = [parts[0], parts[1], parts[2], parts[3], raw.toString('base64')].join(':')
  assert.throws(() => decryptText(tampered, KEY))
})

test('isEncrypted 只认 enc:v1:；未知版本不算', () => {
  assert.equal(isEncrypted(encryptText('x', KEY)), true)
  assert.equal(isEncrypted('plain text'), false)
  assert.equal(isEncrypted('enc:v2:a:b:c'), false)
  assert.equal(isEncrypted(''), false)
})

test('readSecret：明文原样返回（懒迁移过渡期），密文解密', () => {
  assert.equal(readSecret('plain', KEY), 'plain')
  assert.equal(readSecret(encryptText('secret', KEY), KEY), 'secret')
})

test('deriveKey 稳定且长度 32；不同密钥不同', () => {
  const s = generateSecret()
  const a = deriveKey(s)
  const b = deriveKey(s)
  assert.equal(a.length, 32)
  assert.deepEqual(a, b)
  assert.notDeepEqual(a, deriveKey(generateSecret()))
})

test('parseSecret 拒绝长度不对的密钥，错误信息指路', () => {
  assert.throws(() => parseSecret(Buffer.alloc(16).toString('base64')), /PINBOARD_SECRET/)
  assert.throws(() => parseSecret('not base64 !!'), /PINBOARD_SECRET/)
  assert.equal(parseSecret(generateSecret()).length, 32)
})

test('懒迁移：明文邮箱密码就地加密，跑两次结果一致', () => {
  const db = new DatabaseSync(':memory:')
  db.exec("CREATE TABLE mail_accounts (id INTEGER PRIMARY KEY, password TEXT NOT NULL DEFAULT '')")
  db.prepare('INSERT INTO mail_accounts (id, password) VALUES (1, ?)').run('plain-pass')
  db.prepare('INSERT INTO mail_accounts (id, password) VALUES (2, ?)').run('')
  const first = migrateSecrets(db, KEY, mkdtempSync(join(tmpdir(), 'sec-')))
  assert.equal(first.mail, 1)
  const row = db.prepare('SELECT password FROM mail_accounts WHERE id = 1').get() as any
  assert.match(row.password, /^enc:v1:/)
  assert.equal(decryptText(row.password, KEY), 'plain-pass')
  const again = migrateSecrets(db, KEY, mkdtempSync(join(tmpdir(), 'sec-')))
  assert.equal(again.mail, 0)
  assert.equal((db.prepare('SELECT password FROM mail_accounts WHERE id = 1').get() as any).password, row.password)
  db.close()
})

test('懒迁移：kuma-pass.txt 与 metrics.json 的 base 就地加密，明文文件被替换', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sec-'))
  writeFileSync(join(dir, 'kuma-pass.txt'), 'kuma-secret\n', 'utf8')
  writeFileSync(join(dir, 'metrics.json'), JSON.stringify({ base: 'https://example.com/metrics/tok/', hosts: [] }), 'utf8')
  const db = new DatabaseSync(':memory:')
  db.exec("CREATE TABLE mail_accounts (id INTEGER PRIMARY KEY, password TEXT NOT NULL DEFAULT '')")
  const r = migrateSecrets(db, KEY, dir)
  assert.equal(r.kuma, 1)
  assert.equal(r.metrics, 1)
  const kumaFile = readFileSync(join(dir, 'kuma-pass.txt'), 'utf8').trim()
  assert.match(kumaFile, /^enc:v1:/)
  assert.equal(decryptText(kumaFile, KEY), 'kuma-secret')
  const cfg = JSON.parse(readFileSync(join(dir, 'metrics.json'), 'utf8'))
  assert.match(cfg.base, /^enc:v1:/)
  assert.equal(decryptText(cfg.base, KEY), 'https://example.com/metrics/tok/')
  assert.deepEqual(cfg.hosts, [])
  const r2 = migrateSecrets(db, KEY, dir)
  assert.deepEqual([r2.kuma, r2.metrics], [0, 0])
  db.close()
})
test('主密钥加载：环境变量优先，其次 secret.key，都没有就生成并落盘 0600', async () => {
  const { loadKey, resetKeyCache } = await import('../../server/secrets/key.js')
  const dir = mkdtempSync(join(tmpdir(), 'key-'))
  const envSecret = generateSecret()
  resetKeyCache()
  process.env.PINBOARD_SECRET = envSecret
  const fromEnv = loadKey(dir)
  assert.deepEqual(fromEnv, deriveKey(envSecret))
  assert.equal(existsSync(join(dir, 'secret.key')), false, '环境变量给了就不该再写文件')
  delete process.env.PINBOARD_SECRET

  resetKeyCache()
  const generated = loadKey(dir)
  assert.equal(generated.length, 32)
  const file = readFileSync(join(dir, 'secret.key'), 'utf8').trim()
  assert.equal(parseSecret(file).length, 32)
  // Windows 不认 POSIX 权限位（Node 写出来仍是 0666），只在类 Unix 上断言
  if (process.platform !== 'win32') {
    const mode = statSync(join(dir, 'secret.key')).mode & 0o777
    assert.equal(mode, 0o600, '密钥文件必须 0600')
  }
  resetKeyCache()
  assert.deepEqual(loadKey(dir), generated, '第二次读同一把密钥')
})

test('主密钥加载：环境变量长度不对就报错，不静默降级', async () => {
  const { loadKey, resetKeyCache } = await import('../../server/secrets/key.js')
  const dir = mkdtempSync(join(tmpdir(), 'key-'))
  process.env.PINBOARD_SECRET = Buffer.alloc(8).toString('base64')
  resetKeyCache()
  assert.throws(() => loadKey(dir), /PINBOARD_SECRET/)
  delete process.env.PINBOARD_SECRET
  resetKeyCache()
})
