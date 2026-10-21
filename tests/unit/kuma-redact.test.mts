import test from 'node:test'
import assert from 'node:assert/strict'
import { describeTarget, redactUrl, summarizePolicy, toView } from '../../server/kuma/redact.js'

test('redactUrl：打码账号密码与敏感 query', () => {
  const out = redactUrl('https://user:pass@example.com/path?token=abc&ok=1')
  assert.ok(out.includes('***@'), out)
  assert.ok(!out.includes('user'), out)
  assert.ok(!out.includes('pass'), out)
  assert.ok(out.includes('token=***'), out)
  assert.ok(out.includes('ok=1'), out)
})

test('redactUrl：非 URL 文本走兜底正则', () => {
  assert.equal(redactUrl('not a url token=abc'), 'not a url token=***')
  assert.equal(redactUrl(''), '')
})

test('describeTarget：推送型', () => {
  assert.equal(describeTarget({ type: 'push' }), '推送型（由外部心跳驱动）')
})

test('describeTarget：HTTP 目标里的密钥打码', () => {
  assert.equal(describeTarget({ type: 'http', url: 'https://a.com/x?key=abc' }), 'https://a.com/x?key=***')
})

test('describeTarget：端口型 host:port', () => {
  assert.equal(describeTarget({ type: 'port', hostname: '1.2.3.4', port: 443 }), '1.2.3.4:443')
  assert.equal(describeTarget({ type: 'port', hostname: 'h' }), 'h')
})

test('describeTarget：ssh 命令里的口令打码', () => {
  assert.equal(
    describeTarget({ type: 'ssh', hostname: '1.2.3.4', port: 22, sshUsername: 'root', sshCommand: 'echo --password=secret' }),
    'root@1.2.3.4:22  echo --password=***',
  )
})

test('describeTarget：dns / docker / mqtt', () => {
  assert.equal(describeTarget({ type: 'dns', dns_resolve_server: '8.8.8.8' }), '8.8.8.8')
  assert.equal(describeTarget({ type: 'docker', docker_container: 'nginx' }), 'nginx')
  assert.ok(!describeTarget({ type: 'mqtt', mqttServer: 'mqtt://u:p@h:1883' }).includes('p@'))
})

test('describeTarget：未知类型退回主机名，全空给 —', () => {
  assert.equal(describeTarget({ type: 'weird', hostname: 'h' }), 'h')
  assert.equal(describeTarget({}), '—')
})

test('summarizePolicy：空值', () => {
  assert.equal(summarizePolicy(null), null)
  assert.equal(summarizePolicy(undefined), null)
  assert.equal(summarizePolicy(''), null)
  assert.equal(summarizePolicy('   '), null)
})

test('summarizePolicy：不是 JSON 就当自定义原文', () => {
  assert.deepEqual(summarizePolicy('plain text'), { name: '自定义', summary: 'plain text' })
})

test('summarizePolicy：固定频率', () => {
  assert.deepEqual(summarizePolicy({ interval: { default: 300 } }), { name: '自定义策略', summary: '频率：固定每 5 分钟' })
})

test('summarizePolicy：门控 + 复查间隔', () => {
  const p = summarizePolicy({ gate: { when: { time: { from: '09:00', to: '18:00' } }, recheck: 600 } })
  assert.equal(p?.name, '门控')
  assert.equal(p?.summary, '门控：时间 09:00–18:00 才检查（否则每 10 分钟复查一次）')
})

test('summarizePolicy：门控 + 条件频率，id 换成名字', () => {
  const p = summarizePolicy(
    {
      gate: { when: { monitorStatus: { id: 27, is: 'DOWN' } } },
      interval: { default: 300, rules: [{ when: { weekday: [1, 2, 3, 4, 5] }, interval: 60 }] },
    },
    { '27': 'app-api' },
  )
  assert.equal(p?.name, '门控 + 条件频率')
  assert.ok(p!.summary.startsWith('门控：'), p!.summary)
  assert.ok(p!.summary.includes('「app-api」 为 DOWN'), p!.summary)
  assert.ok(p!.summary.includes('星期 1,2,3,4,5 → 每 1 分钟'), p!.summary)
})

test('summarizePolicy：规则多于 4 条只列 4 条并提示剩余', () => {
  const rules = Array.from({ length: 6 }, () => ({ when: { weekday: [1] }, interval: 60 }))
  const p = summarizePolicy({ interval: { default: 300, rules } })
  assert.equal(p?.name, '条件频率')
  assert.ok(p!.summary.includes('另有 2 条规则'), p!.summary)
})

test('summarizePolicy：JSON 字符串也能解析', () => {
  assert.equal(summarizePolicy('{"interval":{"default":60}}')?.name, '自定义策略')
})

test('toView：只给白名单字段', () => {
  const view = toView({ id: 7, name: 'x', type: 'http', url: 'https://a?token=1', secret: 'nope', showMsg: 1, active: true, interval: 120, timeout: 10, maxretries: 2, retryInterval: 30 })
  assert.deepEqual(Object.keys(view).sort(), ['active', 'description', 'id', 'interval', 'maxretries', 'name', 'policy', 'retryInterval', 'showMsg', 'target', 'timeout', 'type'])
  assert.equal(view.showMsg, true)
  assert.equal(view.active, true)
  assert.equal(view.target, 'https://a/?token=***')
  assert.equal(view.policy, null)
})

test('toView：空 bean 的默认值', () => {
  const view = toView({})
  assert.equal(view.id, 0)
  assert.equal(view.type, 'http')
  assert.equal(view.interval, 60)
  assert.equal(view.retryInterval, 60)
  assert.equal(view.target, '—')
  assert.equal(view.policy, null)
})

test('toView：policy_json 读得到', () => {
  const view = toView({ id: 1, name: 'n', policy_json: '{"interval":{"default":60}}' })
  assert.equal(view.policy?.name, '自定义策略')
})
