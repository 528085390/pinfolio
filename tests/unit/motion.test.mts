import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FLICK_VELOCITY,
  SPRING_DRAWER,
  SPRING_MOVE,
  prefersReducedMotion,
  project,
  rubberband,
  spring,
  springParams,
} from '../../web/lib/motion.js'

/* ---------- 假 rAF：手动推进时间，验证弹簧的行为 ---------- */

interface FakeFrames {
  frame: (dt?: number) => void
  now: () => number
  pending: () => number
  restore: () => void
}

function installFakeRaf(): FakeFrames {
  const g = globalThis as unknown as Record<string, unknown>
  const prevRaf = g.requestAnimationFrame
  const prevCancel = g.cancelAnimationFrame
  let seq = 0
  let now = 0
  let queue = new Map<number, (t: number) => void>()
  g.requestAnimationFrame = (cb: (t: number) => void) => {
    const id = ++seq
    queue.set(id, cb)
    return id
  }
  g.cancelAnimationFrame = (id: number) => {
    queue.delete(id)
  }
  return {
    frame: (dt = 16) => {
      now += dt
      const due = [...queue.values()]
      queue = new Map()
      for (const cb of due) cb(now)
    },
    now: () => now,
    pending: () => queue.size,
    restore: () => {
      g.requestAnimationFrame = prevRaf
      g.cancelAnimationFrame = prevCancel
    },
  }
}

/* ---------- springParams ---------- */

test('springParams：Apple 抽屉参数 0.8 / 0.3 换算成 k 与 c', () => {
  const { stiffness, damping, mass } = springParams(0.8, 0.3)
  assert.equal(mass, 1)
  assert.ok(Math.abs(stiffness - 438.6490844928604) < 1e-6, 'stiffness=' + stiffness)
  assert.ok(Math.abs(damping - 33.51032163829113) < 1e-6, 'damping=' + damping)
})

test('springParams：移动参数 1.0 / 0.4 换算成 k 与 c', () => {
  const { stiffness, damping, mass } = springParams(1.0, 0.4)
  assert.equal(mass, 1)
  assert.ok(Math.abs(stiffness - 246.74011002723395) < 1e-6, 'stiffness=' + stiffness)
  assert.ok(Math.abs(damping - 31.41592653589793) < 1e-6, 'damping=' + damping)
})

test('springParams：response 越短越硬、zeta 越大阻尼越大', () => {
  assert.ok(springParams(0.8, 0.2).stiffness > springParams(0.8, 0.5).stiffness)
  assert.ok(springParams(1, 0.3).damping > springParams(0.5, 0.3).damping)
})

test('SPRING_DRAWER / SPRING_MOVE：Apple 出货值', () => {
  assert.deepEqual(SPRING_DRAWER, { zeta: 0.8, response: 0.3 })
  assert.deepEqual(SPRING_MOVE, { zeta: 1.0, response: 0.4 })
})

/* ---------- project ---------- */

test('project：Apple 动量投影原式的具体值', () => {
  assert.ok(Math.abs(project(1) - 0.499) < 1e-12, 'project(1)=' + project(1))
  assert.ok(Math.abs(project(0.11) - 0.05489) < 1e-12, 'project(0.11)=' + project(0.11))
  assert.equal(project(0), 0)
})

test('project：与速度成正比、可换 decel', () => {
  assert.equal(project(-2), -project(2))
  // decel=0.99 → v/1000 * 0.99/0.01 = v * 99 / 1000
  assert.ok(Math.abs(project(1, 0.99) - 0.099) < 1e-12)
  assert.ok(project(1) > project(1, 0.9))
})

/* ---------- rubberband ---------- */

test('rubberband：0 输入返回 0，符号随输入', () => {
  assert.equal(rubberband(0, 400), 0)
  assert.equal(rubberband(0, 400, 0.2), 0)
  assert.equal(rubberband(-30, 400), -rubberband(30, 400))
})

test('rubberband：单调递增，但永远吃不满整段 dimension', () => {
  const dim = 400
  let prev = 0
  for (const d of [1, 10, 50, 100, 200, 400, 1000, 1e4, 1e6]) {
    const r = rubberband(d, dim)
    assert.ok(r > prev, 'd=' + d + ' 应比上一档大')
    assert.ok(r < dim, 'd=' + d + ' 应小于 dimension，实际 ' + r)
    prev = r
  }
  // 极限 ≈ dimension（常数只决定起手软硬，不改变上界）
  assert.ok(rubberband(1e9, dim) > dim * 0.9999, '极限应贴近 dimension：' + rubberband(1e9, dim))
  // 小位移处斜率 ≈ coefficient
  assert.ok(Math.abs(rubberband(0.001, dim) / 0.001 - 0.55) < 1e-3)
})

test('rubberband：系数越大同样位移越软', () => {
  assert.ok(rubberband(100, 400, 0.9) > rubberband(100, 400, 0.2))
})

/* ---------- FLICK_VELOCITY ---------- */

test('FLICK_VELOCITY：Apple 甩出阈值 0.11px/ms', () => {
  assert.equal(FLICK_VELOCITY, 0.11)
})

/* ---------- prefersReducedMotion ---------- */

test('prefersReducedMotion：没有 matchMedia 时返回 false（SSR / 测试安全）', () => {
  const g = globalThis as unknown as Record<string, unknown>
  const prev = g.matchMedia
  delete g.matchMedia
  try {
    assert.equal(prefersReducedMotion(), false)
  } finally {
    if (prev !== undefined) g.matchMedia = prev
  }
})

test('prefersReducedMotion：matchMedia 命中 reduce 时为 true', () => {
  const g = globalThis as unknown as Record<string, unknown>
  const prev = g.matchMedia
  const asked: string[] = []
  g.matchMedia = (q: string) => {
    asked.push(q)
    return { matches: true, media: q }
  }
  try {
    assert.equal(prefersReducedMotion(), true)
    assert.deepEqual(asked, ['(prefers-reduced-motion: reduce)'])
  } finally {
    if (prev === undefined) delete g.matchMedia
    else g.matchMedia = prev
  }
})

test('prefersReducedMotion：matchMedia 未命中时为 false', () => {
  const g = globalThis as unknown as Record<string, unknown>
  const prev = g.matchMedia
  g.matchMedia = (q: string) => ({ matches: false, media: q })
  try {
    assert.equal(prefersReducedMotion(), false)
  } finally {
    if (prev === undefined) delete g.matchMedia
    else g.matchMedia = prev
  }
})

/* ---------- spring ---------- */

test('spring：欠阻尼（0.8/0.3）会越过 target 再回落', () => {
  const raf = installFakeRaf()
  try {
    const seen: number[] = []
    let done = 0
    spring({
      from: 0,
      to: 100,
      velocity: 0,
      ...SPRING_DRAWER,
      onFrame: (v) => seen.push(v),
      onDone: () => {
        done++
      },
    })
    let peak = 0
    for (let i = 0; i < 200 && raf.pending(); i++) {
      raf.frame()
      peak = Math.max(peak, seen[seen.length - 1])
    }
    assert.ok(peak > 100, '过冲应越过 100，实际峰值 ' + peak)
    assert.ok(peak < 130, '过冲应收敛，实际峰值 ' + peak)
    assert.equal(seen[seen.length - 1], 100, '收尾应精确落到 target')
    assert.equal(done, 1)
    assert.equal(raf.pending(), 0, 'Done 之后不应再排帧')
  } finally {
    raf.restore()
  }
})

test('spring：临界阻尼（1.0/0.4）不越过 target', () => {
  const raf = installFakeRaf()
  try {
    const seen: number[] = []
    let done = 0
    spring({
      from: 0,
      to: 100,
      velocity: 0,
      ...SPRING_MOVE,
      onFrame: (v) => seen.push(v),
      onDone: () => {
        done++
      },
    })
    for (let i = 0; i < 200 && raf.pending(); i++) {
      raf.frame()
      for (const v of seen) assert.ok(v <= 100, '不允许越过 target，出现 ' + v)
    }
    assert.equal(seen[seen.length - 1], 100)
    assert.equal(done, 1)
  } finally {
    raf.restore()
  }
})

test('spring：单调逼近（临界阻尼且无初速时一路增大）', () => {
  const raf = installFakeRaf()
  try {
    const seen: number[] = []
    spring({ from: 0, to: 60, ...SPRING_MOVE, onFrame: (v) => seen.push(v) })
    for (let i = 0; i < 200 && raf.pending(); i++) raf.frame()
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1], '第 ' + i + ' 帧回落了')
  } finally {
    raf.restore()
  }
})

test('spring：onDone 只调一次，即使继续推进帧', () => {
  const raf = installFakeRaf()
  try {
    let done = 0
    spring({ from: 0, to: 20, ...SPRING_DRAWER, onFrame: () => {}, onDone: () => done++ })
    for (let i = 0; i < 400; i++) {
      if (raf.pending()) raf.frame()
      else break
    }
    assert.equal(done, 1)
    raf.frame()
    raf.frame()
    assert.equal(done, 1)
  } finally {
    raf.restore()
  }
})

test('spring：cancel 之后不再回调，也不再排帧', () => {
  const raf = installFakeRaf()
  try {
    let frames = 0
    let done = 0
    const cancel = spring({
      from: 0,
      to: 300,
      velocity: 0,
      ...SPRING_DRAWER,
      onFrame: () => frames++,
      onDone: () => done++,
    })
    raf.frame()
    raf.frame()
    const before = frames
    assert.ok(before > 0)
    cancel()
    for (let i = 0; i < 100; i++) if (raf.pending()) raf.frame()
    assert.equal(frames, before, 'cancel 后不应再回调 onFrame')
    assert.equal(done, 0, 'cancel 后不应回调 onDone')
    assert.equal(raf.pending(), 0)
    cancel() // 二次 cancel 无害
  } finally {
    raf.restore()
  }
})

test('spring：from 已在 target 上且无初速时立即 Done', () => {
  const raf = installFakeRaf()
  try {
    const seen: number[] = []
    let done = 0
    spring({ from: 50, to: 50, ...SPRING_MOVE, onFrame: (v) => seen.push(v), onDone: () => done++ })
    raf.frame()
    assert.deepEqual(seen, [50])
    assert.equal(done, 1)
    assert.equal(raf.pending(), 0)
  } finally {
    raf.restore()
  }
})

test('spring：松手速度（px/ms）越大越快到位', () => {
  const framesToDone = (velocity: number) => {
    const raf = installFakeRaf()
    try {
      let n = 0
      let done = 0
      spring({
        from: 200,
        to: 400,
        velocity,
        ...SPRING_MOVE,
        onFrame: () => n++,
        onDone: () => done++,
      })
      let guard = 0
      while (raf.pending() && guard++ < 500) raf.frame()
      assert.equal(done, 1)
      return n
    } finally {
      raf.restore()
    }
  }
  const slow = framesToDone(0)
  const fast = framesToDone(2)
  assert.ok(fast < slow, '带甩出速度应更快收敛：' + fast + ' vs ' + slow)
})
