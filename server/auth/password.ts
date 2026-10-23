import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

// scrypt 参数（OWASP 推荐的最低档）：N=16384, r=8, p=1，单次约 40–60ms。
const N = 16384
const R = 8
const P = 1
const KEYLEN = 64

/** 存库格式：scrypt$<salt_b64>$<hash_b64>；salt 每次随机。 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P })
  return 'scrypt$' + salt.toString('base64') + '$' + hash.toString('base64')
}

/** 恒定时间比较；存储值损坏时返回 false，不抛错。 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = String(stored || '').split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  let salt: Buffer
  let want: Buffer
  try {
    salt = Buffer.from(parts[1], 'base64')
    want = Buffer.from(parts[2], 'base64')
  } catch {
    return false
  }
  if (salt.length === 0 || want.length === 0) return false
  let got: Buffer
  try {
    got = scryptSync(password, salt, want.length, { N, r: R, p: P })
  } catch {
    return false
  }
  return got.length === want.length && timingSafeEqual(got, want)
}
