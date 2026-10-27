import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// 窗口几何：clampBounds 是纯函数（不碰 fs）；只有 writeWindowState 会建目录、会写盘。
// 读侧的所有异常（文件不在、读失败、JSON 坏、字段类型不对）一律回落到 DEFAULT_BOUNDS，
// 让主进程开窗这条路径永远拿得到一个能用的尺寸。

export type Bounds = { x?: number; y?: number; width: number; height: number }

/** 首次启动的尺寸：不给 x/y，交给 Electron 自己居中 */
export const DEFAULT_BOUNDS: Bounds = { width: 1280, height: 860 }

/** 再小就没法用（三个栏位一挤就看不见内容） */
export const MIN_SIZE = { width: 960, height: 600 }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * 把窗口几何收进可用范围：
 * 1. width/height 先抬到 min（小数四舍五入取整）；
 * 2. 有 x/y 时判断窗口矩形与 workArea 有没有交集，完全没有（换了更小的屏幕、拔了副屏）
 *    就居中；只要露出一部分就保留原坐标，不动用户的习惯位置；
 * 3. 输入没给 x/y 就原样返回，不凭空补坐标（交给 Electron 居中）。
 */
export function clampBounds(
  b: Bounds,
  workArea: Bounds,
  min: { width: number; height: number },
): Bounds {
  const width = Math.max(Math.round(b.width), min.width)
  const height = Math.max(Math.round(b.height), min.height)

  if (b.x === undefined || b.y === undefined) return { ...b, width, height }

  const x = Math.round(b.x)
  const y = Math.round(b.y)
  // workArea 的 x/y 可能没给（等价于原点）
  const wx = workArea.x ?? 0
  const wy = workArea.y ?? 0

  // 矩形相交判据：两个轴都「有重叠」，贴着边（只碰上一条线）不算
  const intersects =
    x < wx + workArea.width &&
    x + width > wx &&
    y < wy + workArea.height &&
    y + height > wy

  if (intersects) return { x, y, width, height }

  return {
    x: Math.round(wx + (workArea.width - width) / 2),
    y: Math.round(wy + (workArea.height - height) / 2),
    width,
    height,
  }
}

/** 读窗口状态；任何不对劲都回落到 DEFAULT_BOUNDS（返回副本，别让调用方改到常量） */
export function readWindowState(file: string): Bounds {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return { ...DEFAULT_BOUNDS }
  }
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_BOUNDS }

  const obj = raw as Record<string, unknown>
  if (!isNum(obj.width) || !isNum(obj.height)) return { ...DEFAULT_BOUNDS }

  const out: Bounds = { width: Math.round(obj.width), height: Math.round(obj.height) }
  // x/y 要么都在、要么都不在；只有一个也当作没有
  if (isNum(obj.x) && isNum(obj.y)) {
    out.x = Math.round(obj.x)
    out.y = Math.round(obj.y)
  }
  return out
}

/** 写窗口状态（本模块唯一会建目录、会写盘的地方） */
export function writeWindowState(file: string, b: Bounds): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(b, null, 2) + '\n', 'utf8')
}
