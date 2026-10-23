import { createHash, randomBytes } from 'node:crypto'

/** 会话 token：32 字节随机，base64url 无填充。库里只存它的 sha256。 */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(String(token)).digest('hex')
}

/** API token：pb_ 前缀便于在日志里一眼认出来；明文只在创建时返回一次。 */
export function newApiToken(): { token: string; hash: string } {
  const token = 'pb_' + randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token) }
}
