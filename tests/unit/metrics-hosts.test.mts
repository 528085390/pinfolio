// 主机清单的纯逻辑（server/metrics/hostmeta.ts）：校验、增删改、写回 data/metrics.json 时的合并。
// 这些规则原来埋在 config.ts / routes.ts 里测不到；拆出来钉住边界，免得把带 token 的配置写坏。
// 运行：pnpm test:unit
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseHosts, normalizeHostInput, addHost, patchHost, removeHost, mergeMetricsFile, visibleFailures,
} from '../../server/metrics/hostmeta.js'

const hosts = () => [
  { id: 'my-server', label: 'my-server', note: '阿里云 · 北京' },
  { id: 'az', label: 'az', note: 'Azure · 美中', paused: true },
]

/* ---------------- parseHosts ---------------- */

test('parseHosts：丢掉没 id 的条目，trim 并补默认 label', () => {
  const out = parseHosts([
    { id: '  my-server  ', label: '  wb  ', note: '  北京 ' },
    { id: '' },
    { label: '没有 id' },
    null,
    'x',
  ])
  assert.deepEqual(out, [{ id: 'my-server', label: 'wb', note: '北京' }])
})

test('parseHosts：label 空时回落到 id，paused 只认 true', () => {
  const out = parseHosts([
    { id: 'os', label: '', note: '', paused: true },
    { id: 'ox', paused: 'true' },
    { id: 'aws', paused: 1 },
  ])
  assert.deepEqual(out, [
    { id: 'os', label: 'os', note: '', paused: true },
    { id: 'ox', label: 'ox', note: '' },
    { id: 'aws', label: 'aws', note: '' },
  ])
})

test('parseHosts：重复 id 只留第一条，不认识的形状跳过', () => {
  const out = parseHosts([
    { id: 'oj', note: '第一' },
    { id: 'oj', note: '第二' },
    { id: 42 },
  ])
  assert.deepEqual(out, [{ id: 'oj', label: 'oj', note: '第一' }])
})

test('parseHosts：不是数组回空表', () => {
  assert.deepEqual(parseHosts(null), [])
  assert.deepEqual(parseHosts({ hosts: [] }), [])
})

/* ---------------- normalizeHostInput ---------------- */

test('normalizeHostInput：合法输入 trim 后落库，label 默认等于 id', () => {
  const r = normalizeHostInput({ id: '  my-server-2 ', label: '  ', note: '  测试机 ' })
  assert.deepEqual(r, { ok: true, host: { id: 'my-server-2', label: 'my-server-2', note: '测试机' } })
})

test('normalizeHostInput：id 不能为空', () => {
  assert.deepEqual(normalizeHostInput({ id: '   ' }), { ok: false, error: '主机 id 不能为空' })
  assert.deepEqual(normalizeHostInput({}), { ok: false, error: '主机 id 不能为空' })
})

test('normalizeHostInput：id 只允许字母数字点下划线短横线', () => {
  for (const bad of ['wb server', '主机', 'a/b', 'a:b', 'a\\b']) {
    const r = normalizeHostInput({ id: bad })
    assert.equal(r.ok, false, bad)
    assert.equal((r as any).error, '主机 id 只能用字母、数字、点、下划线、短横线')
  }
  assert.equal(normalizeHostInput({ id: 'a.b_c-1' }).ok, true)
})

test('normalizeHostInput：id 最长 32 位，不能以符号开头', () => {
  assert.equal(normalizeHostInput({ id: 'x'.repeat(32) }).ok, true)
  assert.deepEqual(normalizeHostInput({ id: 'x'.repeat(33) }), { ok: false, error: '主机 id 最长 32 位' })
  assert.deepEqual(normalizeHostInput({ id: '-abc' }), { ok: false, error: '主机 id 只能用字母、数字、点、下划线、短横线' })
})

test('normalizeHostInput：label 最长 40、note 最长 60', () => {
  assert.deepEqual(normalizeHostInput({ id: 'a', label: 'x'.repeat(41) }), { ok: false, error: '名字最长 40 字' })
  assert.deepEqual(normalizeHostInput({ id: 'a', note: 'x'.repeat(61) }), { ok: false, error: '备注最长 60 字' })
  assert.equal(normalizeHostInput({ id: 'a', label: 'x'.repeat(40), note: 'x'.repeat(60) }).ok, true)
})

/* ---------------- addHost ---------------- */

test('addHost：追加到末尾，不改原数组', () => {
  const before = hosts()
  const r = addHost(before, { id: 'os', note: 'Oracle · 东京' })
  assert.equal(r.ok, true)
  const next = (r as any).hosts
  assert.deepEqual(next.map((h: any) => h.id), ['my-server', 'az', 'os'])
  assert.deepEqual(next[2], { id: 'os', label: 'os', note: 'Oracle · 东京' })
  assert.equal(before.length, 2)
})

test('addHost：id 重复（不分大小写）拒绝，非法输入直接透传错误', () => {
  assert.deepEqual(addHost(hosts(), { id: 'AZ' }), { ok: false, error: '已经有这台主机：AZ' })
  assert.deepEqual(addHost(hosts(), { id: 'a b' }), { ok: false, error: '主机 id 只能用字母、数字、点、下划线、短横线' })
})

/* ---------------- patchHost ---------------- */

test('patchHost：paused 真值加上、假值删掉（不留下 paused: false）', () => {
  const paused = patchHost(hosts(), 'my-server', { paused: true }) as any
  assert.equal(paused.ok, true)
  assert.equal(paused.hosts[0].paused, true)
  const resumed = patchHost(paused.hosts, 'my-server', { paused: false }) as any
  assert.equal(resumed.hosts[0].paused, undefined)
  assert.equal('paused' in resumed.hosts[0], false)
})

test('patchHost：可以同时改 label / note，按 id 找（大小写不敏感）', () => {
  const r = patchHost(hosts(), 'my-server', { label: '阿里云', note: '北京' }) as any
  assert.equal(r.ok, true)
  assert.deepEqual(r.hosts[0], { id: 'my-server', label: '阿里云', note: '北京' })
  assert.equal(r.hosts[1].paused, true)
})

test('patchHost：空 patch 原样返回，未知 id 报错', () => {
  const same = patchHost(hosts(), 'az', {}) as any
  assert.deepEqual(same.hosts, hosts())
  assert.deepEqual(patchHost(hosts(), 'nope', { paused: true }), { ok: false, error: '没有这台主机：nope' })
})

/* ---------------- removeHost ---------------- */

test('removeHost：删掉指定 id，其余保序', () => {
  const r = removeHost(hosts(), 'az') as any
  assert.equal(r.ok, true)
  assert.deepEqual(r.hosts.map((h: any) => h.id), ['my-server'])
  assert.deepEqual(removeHost(hosts(), 'nope'), { ok: false, error: '没有这台主机：nope' })
})

/* ---------------- mergeMetricsFile ---------------- */

test('mergeMetricsFile：保留 base 与未知键，只换 hosts', () => {
  const raw = { base: 'https://example.test/metrics/token/', hosts: [{ id: 'old' }], extra: { keep: 1 } }
  const out = mergeMetricsFile(raw, [{ id: 'os', label: 'os', note: '' }])
  assert.deepEqual(out, {
    base: 'https://example.test/metrics/token/',
    hosts: [{ id: 'os', label: 'os', note: '' }],
    extra: { keep: 1 },
  })
  assert.deepEqual(raw.hosts, [{ id: 'old' }])
})

/* ---------------- visibleFailures ---------------- */

test('visibleFailures：删掉 / 暂停的主机不再挂在失败清单里', () => {
  const failed = [{ id: 'my-server', error: '404' }, { id: 'az', error: 'timeout' }, { id: 'gone', error: '404' }]
  assert.deepEqual(visibleFailures(failed, hosts()), [{ id: 'my-server', error: '404' }])
})

test('visibleFailures：全都在跑时原样返回，空表也安全', () => {
  const failed = [{ id: 'my-server', error: '404' }]
  assert.deepEqual(visibleFailures(failed, [{ id: 'my-server', label: 'wb', note: '' }]), failed)
  assert.deepEqual(visibleFailures([], hosts()), [])
})

test('mergeMetricsFile：文件是空对象 / null 时也能写', () => {
  assert.deepEqual(mergeMetricsFile({}, []), { hosts: [] })
  assert.deepEqual(mergeMetricsFile(null, []), { hosts: [] })
})
/* ---------------- 采集端参数（units / disks / address） ---------------- */

test('normalizeHostInput：带上采集端参数，写进主机条目', () => {
  const r = normalizeHostInput({ id: 'os2', units: 'sing-box, xray', disks: '/ /mnt/data', address: ' 203.0.113.11 ' })
  if (!r.ok) assert.fail(r.error)
  assert.deepEqual(r.host, {
    id: 'os2', label: 'os2', note: '',
    units: ['sing-box', 'xray'], disks: ['/', '/mnt/data'], address: '203.0.113.11',
  })
})

test('normalizeHostInput：只填默认磁盘 / 不落盘；非法单元名给中文错误', () => {
  const ok = normalizeHostInput({ id: 'a', disks: '/' })
  if (!ok.ok) assert.fail(ok.error)
  assert.equal('disks' in ok.host, false)
  const bad = normalizeHostInput({ id: 'a', units: 'x;rm -rf /' })
  assert.equal(bad.ok, false)
})

test('parseHosts：坏掉的 units/disks 当没有（配置写坏了也不能让主机页起不来）', () => {
  const out = parseHosts([{ id: 'x', units: ['ok', 'bad/name'], disks: ['rel'], address: ' 1.2.3.4 ' }])
  assert.equal(out[0].units, undefined)
  assert.equal(out[0].disks, undefined)
  assert.equal(out[0].address, '1.2.3.4')
})

test('monitors：顺带建的观测项 id 记住、坏值丢掉、传空数组清掉', () => {
  const r = patchHost([{ id: 'x', label: 'x', note: '' }], 'x', { monitors: [141, 0, 141, 'a', 139] })
  if (!r.ok) assert.fail(r.error)
  assert.deepEqual(r.hosts[0].monitors, [141, 139])
  const back = parseHosts([{ id: 'x', monitors: [141, -3, 'x', 2.5, 139] }])
  assert.deepEqual(back[0].monitors, [141, 139])
  const cleared = patchHost(r.hosts, 'x', { monitors: [] })
  if (!cleared.ok) assert.fail(cleared.error)
  assert.equal('monitors' in cleared.hosts[0], false)
  assert.equal('monitors' in parseHosts([{ id: 'y' }])[0], false)
})

test('group：顺带建的分组 id 记在主机条目里，坏值丢掉', () => {
  const r = patchHost([{ id: 'x', label: 'x', note: '' }], 'x', { group: 13 })
  if (!r.ok) assert.fail(r.error)
  assert.equal(r.hosts[0].group, 13)
  assert.equal(parseHosts([{ id: 'x', group: 13 }])[0].group, 13)
  assert.equal('group' in parseHosts([{ id: 'x', group: -1 }])[0], false)
  assert.equal('group' in parseHosts([{ id: 'x', group: 'abc' }])[0], false)
})

test('patchHost：能改采集端参数，传空值就清掉', () => {
  const r = patchHost([{ id: 'x', label: 'x', note: '', units: ['a'], address: 'h' }], 'x', { units: [], address: '' })
  if (!r.ok) assert.fail(r.error)
  assert.equal('units' in r.hosts[0], false)
  assert.equal('address' in r.hosts[0], false)
})
