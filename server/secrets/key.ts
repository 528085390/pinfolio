import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deriveKey, generateSecret, parseSecret } from './crypto.js'

// 主密钥来源（按优先级）：
//   1. PINBOARD_SECRET 环境变量（32 字节 base64）—— 容器/系统服务推荐
//   2. <dataDir>/secret.key（内容同格式）—— 裸机默认
//   3. 都没有 → 首次启动生成一把并写 0600
// 密钥缺失或长度不对一律抛错，绝不静默降级成明文。

let cached: { dir: string; key: Buffer } | null = null

/** 清缓存（测试用；进程里只有启动时调一次）。 */
export function resetKeyCache() {
  cached = null
}

export function secretFile(dataDir: string): string {
  return join(dataDir, 'secret.key')
}

/** 读或生成主密钥，返回派生后的 AES key。 */
export function loadKey(dataDir: string): Buffer {
  if (cached && cached.dir === dataDir) return cached.key
  const fromEnv = process.env.PINBOARD_SECRET
  let secret: string
  if (fromEnv && fromEnv.trim()) {
    secret = fromEnv.trim()
    parseSecret(secret) // 长度不对直接抛，别等到解密时才炸
  } else {
    const file = secretFile(dataDir)
    if (existsSync(file)) {
      secret = readFileSync(file, 'utf8').trim()
      parseSecret(secret)
    } else {
      secret = generateSecret()
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(file, secret + '\n', { encoding: 'utf8', mode: 0o600 })
      try { chmodSync(file, 0o600) } catch { /* Windows 上 chmod 基本无效，忽略 */ }
    }
  }
  const key = deriveKey(secret)
  cached = { dir: dataDir, key }
  return key
}
