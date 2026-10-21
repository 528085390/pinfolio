/**
 * 日期差。纯函数（只读系统时钟），单独放一个文件是为了能单测 ——
 * meta.ts 依赖 db.ts，一 import 就会打开 SQLite。
 */

/** 距离 date（YYYY-MM-DD）还有几天；今天 = 0，过期 = 负数，解析不了 = null。 */
export function daysLeft(date: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(date + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}
