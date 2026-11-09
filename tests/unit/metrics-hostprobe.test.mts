// 主机卡片上那段「探针摘要」的纯逻辑（server/metrics/hostprobe.ts）：
// 从观测台已有的心跳里挑一个代表观测项、算延迟 / 丢包 / 色条，不额外探测。
// 运行：pnpm test:unit
import test from 'node:test'
import assert from 'node:assert/strict'
import { matchGroupMonitors, pickProbeMonitor, summarizeProbe } from '../../server/metrics/hostprobe.js'

const mon = (over: Record<string, unknown>) => ({ id: 1, name: 'az / 公网入口', type: 'port', port: 443, ...over }) as any
const beat = (status: number, ping: number | null, time: string) => ({ status, ping, time, msg: '', monitor_id: 1 }) as any

test('pickProbeMonitor：没有候选 / 只有 push 或 SSH 时返回 null', () => {
  assert.equal(pickProbeMonitor([]), null)
  assert.equal(pickProbeMonitor([mon({ id: 1, type: 'push', port: null })]), null)
  // SSH 的 ping 是「连上 + 跑完 systemctl」的耗时（实测 3–5 秒），不能当延迟显示
  assert.equal(pickProbeMonitor([mon({ id: 1, type: 'ssh', port: 22 })]), null)
})

test('pickProbeMonitor：443 端口 > 其他端口 > HTTP', () => {
  const ssh = mon({ id: 1, type: 'ssh', port: 22 })
  const http = mon({ id: 2, type: 'http', port: null })
  const port8443 = mon({ id: 3, type: 'port', port: 8443 })
  const port443 = mon({ id: 4, type: 'port', port: 443 })
  assert.equal(pickProbeMonitor([ssh, http, port8443, port443])?.id, 4)
  assert.equal(pickProbeMonitor([ssh, http, port8443])?.id, 3)
  assert.equal(pickProbeMonitor([ssh, http])?.id, 2)
})

test('matchGroupMonitors：按「组名 / 名字以主机 id 开头」兜底，大小写无关', () => {
  const rows = [
    mon({ id: 1, type: 'port', port: 443, group_name: 'az (Azure · 美中)', name: 'az / 公网入口' }),
    mon({ id: 2, type: 'port', port: 443, group_name: 'oj (Oracle · 东京)', name: 'oj / 代理端口' }),
    mon({ id: 3, type: 'port', port: 443, group_name: '', name: 'AWS / 代理端口 443' }),
  ]
  assert.deepEqual(matchGroupMonitors(rows, 'az').map((m) => m.id), [1])
  assert.deepEqual(matchGroupMonitors(rows, 'aws').map((m) => m.id), [3])
  assert.deepEqual(matchGroupMonitors(rows, 'zz').map((m) => m.id), [])
  assert.deepEqual(matchGroupMonitors(rows, ''), [])
})

test('pickProbeMonitor：同权重取 id 最小的一项，刷新时不会来回跳', () => {
  const a = mon({ id: 9, type: 'port', port: 8443 })
  const b = mon({ id: 5, type: 'port', port: 8443 })
  assert.equal(pickProbeMonitor([a, b])?.id, 5)
  assert.equal(pickProbeMonitor([b, a])?.id, 5)
})

test('summarizeProbe：心跳倒序进、色条升序出，延迟取最近一次有值的那拍', () => {
  const r = summarizeProbe(mon({}), [
    beat(1, null, '2026-11-09T10:03:00Z'),
    beat(1, 96, '2026-11-09T10:02:00Z'),
    beat(1, 210, '2026-11-09T10:01:00Z'),
  ])
  assert.deepEqual(r.beats.map((b) => b.time), [
    '2026-11-09T10:01:00Z', '2026-11-09T10:02:00Z', '2026-11-09T10:03:00Z',
  ])
  assert.equal(r.latencyMs, 96)
  assert.equal(r.lossPct, 0)
  assert.equal(r.at, '2026-11-09T10:03:00Z')
})

test('summarizeProbe：丢包只算 DOWN，待定 / 维护不进分母', () => {
  const r = summarizeProbe(mon({}), [
    beat(1, 80, 't4'),
    beat(0, null, 't3'),
    beat(2, null, 't2'),
    beat(1, 90, 't1'),
  ])
  // 3 拍有结论（2 UP + 1 DOWN）→ 33.3%，PENDING 那拍不算
  assert.equal(r.lossPct, 33.3)
})

test('summarizeProbe：没有心跳时全部回 null / 空数组，不抛异常', () => {
  const r = summarizeProbe(mon({ id: 7, name: 'os / 443' }), [])
  assert.equal(r.latencyMs, null)
  assert.equal(r.lossPct, null)
  assert.deepEqual(r.beats, [])
  assert.equal(r.at, null)
  assert.equal(r.monitorId, 7)
  assert.equal(r.name, 'os / 443')
})

test('summarizeProbe：只取最近 limit 拍（多出来的老数据不进色条，也不进丢包分母）', () => {
  // 最老的那一拍（下标 29）是 DOWN，切掉之后不该再影响丢包
  const rows = Array.from({ length: 30 }, (_, i) => beat(i === 29 ? 0 : 1, 100, 't' + i))
  const r = summarizeProbe(mon({}), rows, 24)
  assert.equal(r.beats.length, 24)
  assert.equal(r.lossPct, 0)
})
