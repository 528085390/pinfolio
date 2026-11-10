// 演示模式：给公开演示站预填登录口令 + 显示「这是演示项目」横幅。
//
// 只有显式设 PINBOARD_DEMO=1 才生效——自用实例调 demoInfo() 永远拿到 null，
// 所以口令与演示文案不会漏进普通部署（/api/auth/state 是免鉴权接口，别在这里放大东西）。
const truthy = (v: string | undefined): boolean => /^(1|true|yes|on)$/i.test((v ?? '').trim())

export const DEMO_ON = truthy(process.env.PINBOARD_DEMO)

/** 横幅里写「每天几点重置」，跟机器上的 systemd timer 对上就行 */
const DEMO_RESET = (process.env.PINBOARD_DEMO_RESET || '04:00 (UTC+8)').trim()

/** 横幅右侧那个链接，指向仓库 */
const DEMO_REPO = (process.env.PINBOARD_DEMO_REPO || 'https://github.com/528085390/pinfolio').trim()

export type DemoInfo = { password: string; reset: string; repo: string }

/** 免鉴权的 /api/auth/state 会带上这个：登录页据此预填口令，登录后横幅据此显示。 */
export function demoInfo(): DemoInfo | null {
  if (!DEMO_ON) return null
  // 演示站的口令本来就是公开的（README 里写着），这里跟着 PINBOARD_PASSWORD 走，免得两处各写一份
  const password = (process.env.PINBOARD_DEMO_PASSWORD || process.env.PINBOARD_PASSWORD || '').trim()
  return { password, reset: DEMO_RESET, repo: DEMO_REPO }
}
