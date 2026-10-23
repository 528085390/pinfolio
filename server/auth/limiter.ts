export type LimitOptions = {
  windowMs: number
  maxFailures: number
  baseBackoffMs: number
  maxBackoffMs: number
}

const DEFAULTS: LimitOptions = {
  windowMs: 15 * 60_000,
  maxFailures: 5,
  baseBackoffMs: 30_000,
  maxBackoffMs: 15 * 60_000,
}

type Entry = { count: number; firstAt: number; blockedUntil: number }

/** 登录失败限流：同 IP 窗口内超过 maxFailures 次后按 30s → 60s → 120s 指数退避。内存态，进程重启清零。 */
export class LoginLimiter {
  private entries = new Map<string, Entry>()
  private opts: LimitOptions

  constructor(opts: Partial<LimitOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts }
  }

  check(ip: string, now = Date.now()): { allowed: boolean; retryAfterMs: number } {
    const e = this.entries.get(ip)
    if (!e) return { allowed: true, retryAfterMs: 0 }
    if (e.blockedUntil > now) return { allowed: false, retryAfterMs: e.blockedUntil - now }
    return { allowed: true, retryAfterMs: 0 }
  }

  fail(ip: string, now = Date.now()): void {
    const e = this.entries.get(ip)
    if (!e || now - e.firstAt > this.opts.windowMs) {
      this.entries.set(ip, { count: 1, firstAt: now, blockedUntil: 0 })
      return
    }
    e.count += 1
    if (e.count >= this.opts.maxFailures) {
      const over = e.count - this.opts.maxFailures
      const backoff = Math.min(this.opts.baseBackoffMs * Math.pow(2, over), this.opts.maxBackoffMs)
      e.blockedUntil = now + backoff
    }
  }

  succeed(ip: string): void {
    this.entries.delete(ip)
  }
}
