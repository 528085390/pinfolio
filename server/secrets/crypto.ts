import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

// 静态加密：只保护「备份 / 库文件泄漏」，防不了进程被控（能读内存就照样拿到明文）。
//
// 主密钥来源见 key.ts：PINBOARD_SECRET 环境变量，或 data/secret.key（首次启动自动生成）。
// 存库格式 enc:v1:<iv_b64>:<tag_b64>:<ct_b64>——版本前缀是给将来轮换留的口子，
// 换算法时加 enc:v2:，老数据仍能按 v1 解。

const INFO = 'pinfolio/v1'
const PREFIX = 'enc:v1:'
const SECRET_BYTES = 32
const IV_BYTES = 12

export class SecretError extends Error {
  code: string
  constructor(message: string, code = 'secret') {
    super(message)
    this.name = 'SecretError'
    this.code = code
  }
}

/** 生成一把新的主密钥（32 字节 base64），给首次启动写 secret.key 用。 */
export function generateSecret(): string {
  return randomBytes(SECRET_BYTES).toString('base64')
}

/** 解析并校验主密钥；长度不对就报错并指路，绝不静默降级成明文。 */
export function parseSecret(input: string): Buffer {
  const raw = String(input ?? '').trim()
  const buf = Buffer.from(raw, 'base64')
  if (!raw || buf.length !== SECRET_BYTES) {
    throw new SecretError(
      '主密钥无效：需要 32 字节 base64。设置环境变量 PINBOARD_SECRET，或删除 data/secret.key 让程序重新生成；' +
      '生成命令：node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64\'))"',
      'bad-key',
    )
  }
  return buf
}

/** HKDF-SHA256(secret, info="pinfolio/v1") → 32 字节 AES key。 */
export function deriveKey(secretB64: string): Buffer {
  const secret = parseSecret(secretB64)
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), INFO, 32))
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX)
}

export function encryptText(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + iv.toString('base64') + ':' + tag.toString('base64') + ':' + ct.toString('base64')
}

export function decryptText(stored: string, key: Buffer): string {
  if (!isEncrypted(stored)) {
    const version = String(stored ?? '').startsWith('enc:') ? String(stored).split(':')[1] : ''
    throw new SecretError(
      version ? '不认识的加密版本 enc:' + version + '，可能是更新的版本写的' : '这段数据没有加密前缀，不能按密文解',
      'unknown-version',
    )
  }
  const parts = stored.split(':')
  if (parts.length !== 5) throw new SecretError('密文格式损坏', 'bad-ciphertext')
  try {
    const iv = Buffer.from(parts[2], 'base64')
    const tag = Buffer.from(parts[3], 'base64')
    const ct = Buffer.from(parts[4], 'base64')
    if (iv.length !== IV_BYTES || tag.length !== 16) throw new Error('iv/tag length')
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
  } catch (e) {
    throw new SecretError('密文无法解密（密钥不匹配或数据损坏）', 'bad-ciphertext')
  }
}

/** 读一个可能是明文也可能是密文的字段：明文原样返回，密文解密。 */
export function readSecret(value: string, key: Buffer): string {
  return isEncrypted(value) ? decryptText(value, key) : value
}
