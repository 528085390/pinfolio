/**
 * 心跳的纯函数：四态颜色、Kuma 时间串 → ISO、beat → 前端视图。
 * feed.ts 里有缓存和网络副作用，把这些挪出来才测得了。
 */

/** 四态心跳：消息前缀 `[绿|黄|红|灰]` 决定这一拍的颜色（Kuma 自身只有 up/down）。 */
const TONE_RE = /^\s*\[(绿|黄|红|灰)\]/

export function toneChar(m?: string | null): string | null {
  const hit = TONE_RE.exec(m || '')
  return hit ? hit[1] : null
}

export type RawBeat = { status?: number; time?: string; msg?: string | null; ping?: number | null }

// Kuma 的心跳时间是**不带时区的 UTC 串**（"2026-10-19 08:35:24.131"，
// 实测 08:43 UTC 对应本机 16:43 CST），直接丢给浏览器 new Date() 会被当本地时间解析，
// 于是「刚刚」显示成「8 小时前」。这里按 UTC 解析再转 ISO，前端才拿到真实时刻。
export function toIso(s?: string | null): string | null {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(s)
  if (!m) return null
  const ms = Number((m[7] || '0').padEnd(3, '0'))
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), ms))
  return isNaN(d.getTime()) ? null : d.toISOString()
}

export function mapBeat(b: RawBeat) {
  return {
    status: typeof b.status === 'number' ? b.status : null,
    time: toIso(b.time),
    msg: String(b.msg || '').trim(),
    ping: typeof b.ping === 'number' ? b.ping : null,
    tone: toneChar(b.msg),
  }
}
