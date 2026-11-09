import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { initMonitorTables, MonitorStore } from '../../server/monitor/store.ts'
import {
  renderMonitorSnapshot,
  writeMonitorSnapshot,
  formatTarget,
  formatPolicyLabel,
} from '../../server/monitor/snapshot.ts'
import type { HeartbeatRow, MonitorRow } from '../../server/monitor/types.ts'

test('formatTarget: formats http, port, ssh, and push targets correctly', () => {
  assert.equal(
    formatTarget({ type: 'http', url: 'https://example.com/api', keyword: 'ok' } as any),
    'https://example.com/api　关键词「ok」'
  )
  assert.equal(
    formatTarget({ type: 'port', hostname: '1.2.3.4', port: 443 } as any),
    '1.2.3.4:443'
  )
  assert.equal(
    formatTarget({
      type: 'ssh',
      ssh_username: 'opc',
      hostname: '1.2.3.4',
      port: 22,
      ssh_command: 'systemctl is-active xray',
    } as any),
    'opc@1.2.3.4:22　systemctl is-active xray'
  )
  assert.equal(formatTarget({ type: 'push' } as any), '—')
})

test('formatPolicyLabel: recognizes presets and custom formats', () => {
  assert.equal(formatPolicyLabel(null), '-')
  assert.equal(formatPolicyLabel(''), '-')
  assert.equal(
    formatPolicyLabel(
      JSON.stringify({
        v: 1,
        timeZone: 'Asia/Shanghai',
        interval: {
          default: 1200,
          rules: [{ when: { time: { from: '08:00', to: '23:00' } }, interval: 60 }],
        },
      })
    ),
    'business-hours'
  )

  // 老数据：加 timeZone 之前存下来的预设 JSON 仍认得出，但要标明它跟随服务器本地时区
  assert.equal(
    formatPolicyLabel(
      JSON.stringify({
        v: 1,
        interval: {
          default: 1200,
          rules: [{ when: { time: { from: '08:00', to: '23:00' } }, interval: 60 }],
        },
      })
    ),
    'business-hours（本地时区）'
  )
})

test('renderMonitorSnapshot: generates structured markdown with groups, overview and tables', () => {
  const monitors: MonitorRow[] = [
    {
      id: 1,
      name: 'WorkBuddy 网关 API（7863）',
      type: 'http',
      group_name: '本机',
      active: 1,
      interval: 60,
      timeout: 10,
      maxretries: 1,
      url: 'http://127.0.0.1:7863/healthz',
      keyword: 'workbuddy2api',
      invert_keyword: 0,
      accepted_statuscodes: '200-299',
      hostname: null,
      port: null,
      ssh_username: null,
      ssh_password: null,
      ssh_private_key: null,
      ssh_passphrase: null,
      ssh_auth_method: 'privateKey',
      ssh_command: null,
      push_token: null,
      outbound_mode: 'direct',
      policy_json: null,
      description: '本机 WorkBuddy 网关',
      created_at: '2026-11-06T10:00:00.000Z',
      updated_at: '2026-11-06T10:00:00.000Z',
    },
    {
      id: 7,
      name: 'oj / Xray 代理服务',
      type: 'ssh',
      group_name: 'oj (Oracle · 东京)',
      active: 1,
      interval: 60,
      timeout: 30,
      maxretries: 2,
      url: null,
      keyword: null,
      invert_keyword: 0,
      accepted_statuscodes: '200-299',
      hostname: '132.145.123.238',
      port: 22,
      ssh_username: 'opc',
      ssh_password: null,
      ssh_private_key: 'key',
      ssh_passphrase: null,
      ssh_auth_method: 'privateKey',
      ssh_command: 'systemctl is-active xray',
      push_token: null,
      outbound_mode: 'direct',
      policy_json: null,
      description: 'oracle-proxy 上的 xray',
      created_at: '2026-11-06T10:00:00.000Z',
      updated_at: '2026-11-06T10:00:00.000Z',
    },
  ]

  const latestBeats = new Map<number, HeartbeatRow>([
    [
      1,
      {
        id: 100,
        monitor_id: 1,
        status: 1,
        ping: 15,
        msg: '200 OK',
        time: '2026-11-06T13:48:00.000Z',
        duration: 15,
        down_count: 0,
      },
    ],
  ])

  // 快照里的时刻按进程本地时区格式化，所以期望值也用本地字段推导，
  // 不写死 +08 结果（否则 UTC runner 上会拿到 05:48，CI 因此红）。
  const localStamp = (d: Date): string =>
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0') +
    ' ' +
    String(d.getHours()).padStart(2, '0') +
    ':' +
    String(d.getMinutes()).padStart(2, '0')

  const fixedDate = new Date('2026-11-06T13:48:00+08:00')
  const heartbeatDate = new Date('2026-11-06T13:48:00.000Z')
  const markdown = renderMonitorSnapshot(monitors, latestBeats, fixedDate)

  assert.match(markdown, /^# 观测台快照/)
  assert.ok(
    markdown.includes('生成时间：' + localStamp(fixedDate)),
    '生成时间应等于入参时刻的本地表示'
  )
  assert.ok(
    markdown.includes('最后心跳：' + localStamp(heartbeatDate)),
    '最后心跳应等于最新心跳时刻的本地表示'
  )
  assert.match(markdown, /## 概览/)
  assert.match(markdown, /观测项 \*\*2\*\* 个（启用 2 \/ 停用 0）/)
  assert.match(markdown, /## 本机（1 项）/)
  assert.match(markdown, /## oj \(Oracle · 东京\)（1 项）/)
  assert.match(markdown, /\| 1 \| WorkBuddy 网关 API（7863） \| HTTP \|/)
  assert.match(markdown, /\| 7 \| oj \/ Xray 代理服务 \| SSH 命令 \|/)
})

test('writeMonitorSnapshot: writes snapshot to specified file path', () => {
  const db = new DatabaseSync(':memory:')
  initMonitorTables(db)
  const store = new MonitorStore(db)

  store.insertMonitor({
    name: 'Test Monitor',
    type: 'http',
    url: 'http://127.0.0.1:8080',
    group_name: '本机',
    active: 1,
  })

  const tempFile = path.join(os.tmpdir(), `snapshot-test-${Date.now()}.md`)
  try {
    writeMonitorSnapshot(tempFile, store, new Date('2026-11-06T12:00:00Z'))
    assert.equal(fs.existsSync(tempFile), true)
    const content = fs.readFileSync(tempFile, 'utf8')
    assert.match(content, /Test Monitor/)
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile)
    }
  }
})
