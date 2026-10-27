import type { DatabaseSync } from 'node:sqlite'
import { createSession, deleteSession, deleteSetting, getSetting, setSetting } from './auth/store.js'

/**
 * 桌面端「本机自动免密」的服务端会话（spec 2026-10-27-pinfolio-desktop，Task 2）。
 *
 * 谁在用：server/app.ts 的 startServer() —— desktopAutoLogin 为真时建一条会话塞进
 * handle.desktopSession，由 Electron 主进程注入渲染进程，跳过登录页。
 *
 * 设计取舍：
 * - **只给本机发**：desktopAutoLogin 在 resolveListenOptions() 里已经卡死「必须回环地址」，
 *   免得把便签库的票签发到 0.0.0.0 上。
 * - **每次启动都发新 token，不复用旧票**：重装 / 重启后旧 token 可能已经泄露给别的窗口
 *   （渲染进程、日志、崩溃转储），复用等于把旧票续命。
 * - 数据库里只存 token 的 sha256（见 auth/store.ts 的 createSession），明文只出现在返回值里。
 * - 建会话是**一个事务**：半途失败（IO 错 / 只读库）不留孤儿票，也不会把上一张票弄丢在半路。
 */

/** 桌面端会话的 UA：设置页的设备列表靠它认出「这台机器自己发的票」 */
export const DESKTOP_UA = 'pinfolio-desktop'

/** 记住当前那条桌面会话的 id。有这个 key 就说明桌面端在跑，退出时按它清票 */
const SETTING_KEY = 'desktop_session_id'

/**
 * 建（或换）一条桌面会话：先按设置里的旧 id 删掉旧会话，再发新的，最后把新 id 记进设置。
 *
 * 幂等：重复调用永远只剩一条 sessions 记录。旧 id 可能已经过期 / 被别处删掉，
 * deleteSession 是 DELETE，删 0 行不会抛。
 */
export function ensureDesktopSession(
  db: DatabaseSync,
  opts: { ip: string; now?: number },
): { id: string; token: string } {
  // 删旧 / 发新 / 记 id 三步必须原子：createSession 成功而 setSetting 抛的话，
  // 会留下一条设置里查不到的孤儿会话——clearDesktopSession 永远找不到它，那张全权票能活满 TTL。
  // 用 IMMEDIATE 立刻拿写锁，别让另一个进程（比如同时开的 Web 实例）在中间插进来。
  db.exec('BEGIN IMMEDIATE')
  try {
    const prev = getSetting(db, SETTING_KEY)
    if (prev) deleteSession(db, prev)
    const session = createSession(db, { ua: DESKTOP_UA, ip: opts.ip, now: opts.now })
    setSetting(db, SETTING_KEY, session.id)
    db.exec('COMMIT')
    return { id: session.id, token: session.token }
  } catch (err) {
    // 回滚失败也别盖住原始错误（原始错误才是排查线索）
    try { db.exec('ROLLBACK') } catch { /* ignore */ }
    throw err
  }
}

/**
 * 清掉桌面会话：退出就别留活票，否则下次谁拿到旧 token 照样能进。
 * 读设置 → 删会话 → 删设置。没有会话 / 没有设置时是空操作。
 */
export function clearDesktopSession(db: DatabaseSync): void {
  const id = getSetting(db, SETTING_KEY)
  if (id) deleteSession(db, id)
  deleteSetting(db, SETTING_KEY)
}
