import type { DatabaseSync } from 'node:sqlite'
import { getSetting, setSetting } from './store.js'
import { hashPassword } from './password.js'

/** 首启用 PINBOARD_PASSWORD 直接设密码（已设过则忽略，避免环境变量覆盖用户改过的密码）。 */
export function bootstrapPassword(db: DatabaseSync): void {
  if (getSetting(db, 'password_hash')) return
  const env = process.env.PINBOARD_PASSWORD
  if (!env) return
  setSetting(db, 'password_hash', hashPassword(env))
  console.log('  已用 PINBOARD_PASSWORD 初始化登录密码')
}
