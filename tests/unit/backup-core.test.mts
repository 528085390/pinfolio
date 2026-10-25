import test from 'node:test'
import assert from 'node:assert/strict'
import { backupFileName, isWeeklySnapshot, pickExpired, csvCell, heartbeatCsv } from '../../server/backup/core.js'
import { scheduledEnabled } from '../../server/backup/schedule.js'
import { createTar, readTar } from '../../server/backup/tar.js'

test('备份文件名带时间戳', () => {
  const d = new Date(2026, 9, 26, 3, 0, 0)
  assert.equal(backupFileName(d), 'pinfolio-20261026-0300.tar.gz')
})

test('周日那份带 kuma 全量', () => {
  assert.equal(isWeeklySnapshot(new Date(2026, 9, 25, 3, 0, 0)), true)   // 2026-10-25 是周日
  assert.equal(isWeeklySnapshot(new Date(2026, 9, 26, 3, 0, 0)), false)
})

test('保留策略只删最旧的', () => {
  const names = ['pinfolio-20261020-0300.tar.gz', 'pinfolio-20261022-0300.tar.gz', 'pinfolio-20261021-0300.tar.gz']
  assert.deepEqual(pickExpired(names, 2), ['pinfolio-20261020-0300.tar.gz'])
  assert.deepEqual(pickExpired(names, 5), [])
  assert.deepEqual(pickExpired(names, 0), [])
})

test('保留策略不碰迁移前快照', () => {
  const names = ['pre-migrate-1-20261020-030000.db', 'pinfolio-20261022-0300.tar.gz', 'pre-migrate-2-20261021-030000.db']
  assert.deepEqual(pickExpired(names, 1), [])
})

test('CSV 单元格会转义引号与换行', () => {
  assert.equal(csvCell('a"b'), '"a""b"')
  assert.equal(csvCell('a,b'), '"a,b"')
  assert.equal(csvCell('a\nb'), '"a\nb"')
  assert.equal(csvCell(null), '')
  assert.equal(csvCell(123), '123')
})

test('心跳 CSV 有表头且每行一个心跳', () => {
  const csv = heartbeatCsv([
    { time: '2026-10-25 01:00:00', monitor_id: 1, monitor_name: '网关', status: 1, msg: 'ok', ping: 12 },
    { time: '2026-10-25 01:01:00', monitor_id: 2, monitor_name: '带,逗号', status: 0, msg: 'down "x"', ping: null },
  ])
  const lines = csv.trim().split('\n')
  assert.equal(lines.length, 3)
  assert.equal(lines[0], 'time,monitor_id,monitor_name,status,msg,ping')
  assert.ok(lines[1].includes('网关'))
  assert.ok(lines[2].includes('"带,逗号"'))
  assert.ok(lines[2].includes('"down ""x"""'))
})

test('BACKUP=0 关掉定时任务，其它值照开', () => {
  const saved = process.env.BACKUP
  try {
    for (const v of ['0', 'off', 'false', 'NO', ' 0 ']) {
      process.env.BACKUP = v
      assert.equal(scheduledEnabled(), false, 'BACKUP=' + v + ' 应关闭')
    }
    for (const v of [undefined, '', '1', 'yes']) {
      if (v === undefined) delete process.env.BACKUP
      else process.env.BACKUP = v
      assert.equal(scheduledEnabled(), true, 'BACKUP=' + String(v) + ' 应开启')
    }
  } finally {
    if (saved === undefined) delete process.env.BACKUP
    else process.env.BACKUP = saved
  }
})

test('tar 写进去能原样读出来', () => {
  const entries = [
    { name: 'a.txt', data: Buffer.from('hello') },
    { name: 'dir/b.bin', data: Buffer.from([1, 2, 3]) },
  ]
  const tar = createTar(entries)
  const back = readTar(tar)
  assert.deepEqual(back.map((e) => e.name), ['a.txt', 'dir/b.bin'])
  assert.equal(back[0].data.toString(), 'hello')
  assert.deepEqual([...back[1].data], [1, 2, 3])
})
