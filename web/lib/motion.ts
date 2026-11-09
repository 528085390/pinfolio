/**
 * Apple 式动效的纯函数库（无依赖、可用单测验证），供抽屉跟手拖拽与弹簧收尾使用。
 *
 * 数值全部取自 spec §4（Apple HIG / WWDC 2018 "Designing Fluid Interfaces" /
 * emilkowalski/skills，MIT），不自己造：
 * - spring 用 **damping ratio(ζ) + response** 表达，再换算成物理量 stiffness / damping；
 * - 动量投影用 Apple 原式（不是 v²/2a）；
 * - 越界用 rubber-band 软化（越拖越硬，永远吃不满整段距离）。
 *
 * 单测见 tests/unit/motion.test.mts。
 */

/** 弹簧物理量。mass 恒为 1（只有 ζ 与 response 是可调维度）。 */
export interface SpringParams {
  stiffness: number
  damping: number
  mass: number
}

/** damping ratio + response(秒) → 弹簧物理量：k = (2π/response)²、c = 4πζ/response。 */
export function springParams(zeta: number, response: number): SpringParams {
  const omega = (2 * Math.PI) / response
  return { stiffness: omega * omega, damping: 4 * Math.PI * zeta / response, mass: 1 }
}

/** 抽屉 / sheet：欠阻尼，会有一点点回弹。 */
export const SPRING_DRAWER = { zeta: 0.8, response: 0.3 }

/** 移动 / 重定位：临界阻尼，不过冲。 */
export const SPRING_MOVE = { zeta: 1.0, response: 0.4 }

/**
 * 动量投影：以当前速度继续滑行会走多远（px）。
 * velocity 单位 px/ms，decel 是每毫秒保留的速度比例；Apple 原式，别换成 v²/2a。
 */
export function project(velocity: number, decel = 0.998): number {
  // Apple 原式 (v/1000)*decel/(1-decel) 的 /1000 是因为 UIScrollView 的 velocity 单位是 pt/s；
  // 本项目 v 用 px/ms，故去掉：v=1 px/ms 时投影 ≈ 499px（几何级数 Σ v·dt·decel^n）。
  return velocity * decel / (1 - decel)
}

/**
 * rubber-band：越界 displacement 被压缩成"越拖越硬"的实际位移。
 * 上界是 dimension（不是 dimension × coefficient）：系数只决定起手软硬。
 */
export function rubberband(overshoot: number, dimension: number, coefficient = 0.55): number {
  return overshoot * dimension * coefficient / (dimension + coefficient * Math.abs(overshoot))
}

/**
 * 抽屉跟手位移：width 以内 **1:1 跟手**，越过抽屉宽度才上 rubberband 阻尼。
 * 全程阻尼（直接 rubberband(dx, width)）会让纯拖拽永远够不到半程阈值——C1 验收实测拖 120px 只动 59px，
 * 结果是只能靠甩速关窗。越界那一小段仍要变硬，才不至于被拖到屏幕外看不见的地方。
 */
export function dragFollow(dx: number, dimension: number, coefficient = 0.55): number {
  if (dx <= dimension) return dx
  return dimension + rubberband(dx - dimension, dimension, coefficient)
}

/** 甩出阈值（px/ms）：Abs(distance)/elapsedMs 超过它就算"甩出去"。 */
export const FLICK_VELOCITY = 0.11

/** 到位判定：位移小于半像素、且速度小于 0.1px/ms 时收尾。 */
const POSITION_EPSILON = 0.5
const VELOCITY_EPSILON = 0.1

/** 用户是否要求减少动效。没有 window / matchMedia（SSR、单测）时按"不减少"处理。 */
export function prefersReducedMotion(): boolean {
  if (typeof globalThis.matchMedia !== 'function') return false
  return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches === true
}

export interface SpringOptions {
  /** 起点（当前屏幕值，被打断时也必须从当前值起）。 */
  from: number
  /** 终点。 */
  to: number
  /** 初速，单位 **px/ms**（与 project / FLICK_VELOCITY 同一个单位，内部换算成 px/s）。 */
  velocity?: number
  /** damping ratio：< 1 欠阻尼（会过冲）、= 1 临界、> 1 过阻尼。 */
  zeta: number
  /** response（秒）：弹簧"响应"的时长，越小越硬。 */
  response: number
  /** 每帧收到当前值（绝对值，不是相对位移）。 */
  onFrame: (value: number) => void
  /** 到位后回调一次（收尾帧已把 onFrame 对齐到 to）。 */
  onDone?: () => void
}

/**
 * rAF 驱动的弹簧：用阻尼振动的解析解（不是数值积分），每帧按 t 求值，
 * 所以掉帧不会累积误差，也天然可打断（再次调用即从新的 from/velocity 起）。
 *
 * ζ < 1 走欠阻尼振荡解，ζ ≥ 1 走临界 / 过阻尼解（不振荡）。
 * 到位（|x-to| < 0.5px 且 |v| < 0.1px/ms）时把 onFrame 钉到 to，调一次 onDone 并停表。
 *
 * 返回 cancel：取消后不再调 onFrame / onDone，也不会再排帧。
 */
export function spring(opts: SpringOptions): () => void {
  const { from, to, zeta, response, onFrame, onDone } = opts
  const raf: ((cb: (t: number) => void) => number) | undefined = globalThis.requestAnimationFrame
  const caf: ((handle: number) => void) | undefined = globalThis.cancelAnimationFrame

  // 没有 rAF（SSR / 无 DOM 环境）：直接落到终点，不排帧、也不用定时器兜底。
  if (typeof raf !== 'function') {
    onFrame(to)
    onDone?.()
    return () => {}
  }

  const x0 = from - to            // 初始位移（相对目标）
  const v0 = (opts.velocity ?? 0) * 1000 // px/ms → px/s
  const omega = (2 * Math.PI) / response

  // 阻尼振动的三个分支：欠阻尼 / 临界 / 过阻尼，系数在开表前一次算好。
  const underdamped = zeta < 1
  const omegaD = underdamped
    ? omega * Math.sqrt(1 - zeta * zeta)
    : zeta > 1
      ? omega * Math.sqrt(zeta * zeta - 1)
      : 0
  const b0 = underdamped ? (v0 + zeta * omega * x0) / omegaD : 0
  const r1 = -zeta * omega + omegaD
  const r2 = -zeta * omega - omegaD
  const aOver = zeta > 1 ? (v0 - x0 * r2) / (r1 - r2) : 0
  const bOver = zeta > 1 ? x0 - aOver : 0

  let cancelled = false
  let finished = false
  let startTime: number | null = null
  let handle: number | null = null

  // t（秒）处的位移（相对目标）与速度（px/s）。
  const sample = (t: number): { x: number; v: number } => {
    if (underdamped) {
      const decay = Math.exp(-zeta * omega * t)
      const cos = Math.cos(omegaD * t)
      const sin = Math.sin(omegaD * t)
      return {
        x: decay * (x0 * cos + b0 * sin),
        v: decay * (-zeta * omega * (x0 * cos + b0 * sin) + omegaD * (b0 * cos - x0 * sin)),
      }
    }
    if (zeta === 1 || omegaD === 0) {
      const b = v0 + omega * x0
      const decay = Math.exp(-omega * t)
      return {
        x: (x0 + b * t) * decay,
        v: (v0 - omega * b * t) * decay,
      }
    }
    const e1 = Math.exp(r1 * t)
    const e2 = Math.exp(r2 * t)
    return { x: aOver * e1 + bOver * e2, v: aOver * r1 * e1 + bOver * r2 * e2 }
  }

  const finish = () => {
    finished = true
    if (handle !== null && typeof caf === 'function') caf(handle)
    handle = null
    onFrame(to)
    onDone?.()
  }

  const tick = (now: number) => {
    handle = null
    if (cancelled || finished) return
    if (startTime === null) startTime = now
    const { x, v } = sample((now - startTime) / 1000)
    // |v| 用 px/ms 与阈值比较，和入参单位保持一致。
    if (Math.abs(x) < POSITION_EPSILON && Math.abs(v) < VELOCITY_EPSILON * 1000) {
      finish()
      return
    }
    onFrame(to + x)
    handle = raf(tick)
  }

  handle = raf(tick)

  return () => {
    if (cancelled || finished) return
    cancelled = true
    if (handle !== null && typeof caf === 'function') caf(handle)
    handle = null
  }
}
