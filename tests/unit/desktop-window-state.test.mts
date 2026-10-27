import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_BOUNDS, MIN_SIZE, clampBounds, readWindowState, writeWindowState,
} from '../../desktop/window-state.js'

// window-state 只有一个模块：clampBounds 是纯函数（不碰 fs），
// readWindowState / writeWindowState 才碰磁盘，并且**只有 writeWindowState 会 mkdir、会写**。
// 全部落盘都在 mkdtemp 出来的临时目录里，测完删掉（同步 fs，没有打开的句柄，Windows 上不会 EPERM）。

const workArea = { x: 0, y: 0, width: 1920, height: 1040 }
const min = { width: 960, height: 600 }

// 临时目录用完就删；t.after 保证失败时也清理。
const tmp = (t: any) => {
  const dir = mkdtempSync(join(tmpdir(), 'pinfolio-winstate-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('常量：默认尺寸 1280x860 且不带 x/y（交给 Electron 居中）', () => {
  assert.equal(DEFAULT_BOUNDS.width, 1280)
  assert.equal(DEFAULT_BOUNDS.height, 860)
  assert.equal(DEFAULT_BOUNDS.x, undefined)
  assert.equal(DEFAULT_BOUNDS.y, undefined)
})

test('常量：最小尺寸 960x600', () => {
  assert.equal(MIN_SIZE.width, 960)
  assert.equal(MIN_SIZE.height, 600)
})

test('clampBounds：尺寸小于下限时抬到 min（x/y 合法就留着）', () => {
  const out = clampBounds({ x: 100, y: 100, width: 400, height: 300 }, workArea, min)
  assert.equal(out.width, 960)
  assert.equal(out.height, 600)
  assert.equal(out.x, 100)
  assert.equal(out.y, 100)
})

test('clampBounds：尺寸够大就原样保留（不被放大也不被缩小）', () => {
  const out = clampBounds({ x: 10, y: 20, width: 1500, height: 900 }, workArea, min)
  assert.deepEqual(out, { x: 10, y: 20, width: 1500, height: 900 })
})

test('clampBounds：窗口完全在 workArea 外时居中', () => {
  // x = 5000 远超 1920 宽的屏幕 → 完全没交集
  const out = clampBounds({ x: 5000, y: 4000, width: 1000, height: 700 }, workArea, min)
  assert.equal(out.width, 1000)
  assert.equal(out.height, 700)
  assert.equal(out.x, Math.round(workArea.x + (workArea.width - 1000) / 2))
  assert.equal(out.y, Math.round(workArea.y + (workArea.height - 700) / 2))
})

test('clampBounds：窗口在负方向越界也算完全在外（换了更小的屏幕）', () => {
  const out = clampBounds({ x: -3000, y: -2000, width: 1000, height: 700 }, workArea, min)
  assert.equal(out.x, Math.round((1920 - 1000) / 2))
  assert.equal(out.y, Math.round((1040 - 700) / 2))
})

test('clampBounds：只露出一部分也算有交集，保留原 x/y', () => {
  // 右下角露出 100x100
  const out = clampBounds({ x: 1820, y: 940, width: 1000, height: 700 }, workArea, min)
  assert.equal(out.x, 1820)
  assert.equal(out.y, 940)
})

test('clampBounds：workArea 带偏移（多显示器副屏）时按实际坐标居中', () => {
  const second = { x: 1920, y: -200, width: 1280, height: 1024 }
  const out = clampBounds({ x: 9999, y: 9999, width: 1000, height: 700 }, second, min)
  assert.equal(out.x, Math.round(1920 + (1280 - 1000) / 2))
  assert.equal(out.y, Math.round(-200 + (1024 - 700) / 2))
})

test('clampBounds：输入缺 x/y 时原样返回，不凭空补坐标', () => {
  const out = clampBounds({ width: 1000, height: 700 }, workArea, min)
  assert.equal(out.width, 1000)
  assert.equal(out.height, 700)
  assert.ok(!('x' in out))
  assert.ok(!('y' in out))
})

test('clampBounds：小数坐标取整用 Math.round', () => {
  const out = clampBounds({ x: 10.6, y: 20.4, width: 1000.5, height: 700.4 }, workArea, min)
  assert.equal(out.x, 11)
  assert.equal(out.y, 20)
  assert.equal(out.width, 1001)
  assert.equal(out.height, 700)
})

test('readWindowState：文件不存在 → DEFAULT_BOUNDS', (t) => {
  const dir = tmp(t)
  assert.deepEqual(readWindowState(join(dir, 'nope.json')), DEFAULT_BOUNDS)
})

test('readWindowState：坏 JSON → DEFAULT_BOUNDS', (t) => {
  const dir = tmp(t)
  const f = join(dir, 'window-state.json')
  writeFileSync(f, '{ this is not json', 'utf8')
  assert.deepEqual(readWindowState(f), DEFAULT_BOUNDS)
})

test('readWindowState：字段类型不对 → DEFAULT_BOUNDS', (t) => {
  const dir = tmp(t)
  const f = join(dir, 'window-state.json')
  const bad = [
    '{}',
    'null',
    '[]',
    '{"width":"1280","height":"860"}',
    '{"width":1280}',
    '{"width":1280,"height":null}',
    '{"x":"10","y":20,"width":1280,"height":860}',
  ]
  for (const body of bad) {
    writeFileSync(f, body, 'utf8')
    assert.deepEqual(readWindowState(f), DEFAULT_BOUNDS, `应回落到默认值：${body}`)
  }
})

test('readWindowState：合法内容读回来（含缺少 x/y 的情况）', (t) => {
  const dir = tmp(t)
  const f = join(dir, 'ws.json')
  writeFileSync(f, JSON.stringify({ x: 5, y: 6, width: 1000, height: 700 }), 'utf8')
  assert.deepEqual(readWindowState(f), { x: 5, y: 6, width: 1000, height: 700 })
  writeFileSync(f, JSON.stringify({ width: 1000, height: 700 }), 'utf8')
  assert.deepEqual(readWindowState(f), { width: 1000, height: 700 })
})

test('writeWindowState：自动建父目录，写进去能读回来', (t) => {
  const dir = tmp(t)
  const f = join(dir, 'nested', 'deeper', 'window-state.json')
  writeWindowState(f, { x: 12, y: 34, width: 1280, height: 860 })
  assert.deepEqual(readWindowState(f), { x: 12, y: 34, width: 1280, height: 860 })
})

test('writeWindowState：重复写覆盖旧值', (t) => {
  const dir = tmp(t)
  const f = join(dir, 'window-state.json')
  writeWindowState(f, { width: 1000, height: 700 })
  writeWindowState(f, { x: 1, y: 2, width: 1100, height: 800 })
  assert.deepEqual(readWindowState(f), { x: 1, y: 2, width: 1100, height: 800 })
})
