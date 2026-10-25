import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR, get } from '../db.js'
import { loadKey } from '../secrets/key.js'
import { readSecret } from '../secrets/crypto.js'

// Kuma 口令的解析顺序（spec 03）：
//   1. KUMA_PASS 环境变量
//   2. settings.kuma_pass（加密存库，04 容器化后推荐）
//   3. data/kuma-pass.txt（可能已被懒迁移改成 enc:v1:...）
// 读不到返回空串，由 client.ts 报「没有配置口令」。

export function kumaPass(): string {
  const env = process.env.KUMA_PASS
  if (env && env.trim()) return env.trim()
  let key: Buffer
  try {
    key = loadKey(DATA_DIR)
  } catch {
    key = Buffer.alloc(0)
  }
  try {
    const row = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', 'kuma_pass')
    if (row && row.value) return key.length ? readSecret(row.value, key) : ''
  } catch {
    /* 库还没建好就算了，落到文件 */
  }
  try {
    const raw = readFileSync(join(DATA_DIR, 'kuma-pass.txt'), 'utf8').trim()
    if (!raw) return ''
    return key.length ? readSecret(raw, key) : raw
  } catch {
    return ''
  }
}
