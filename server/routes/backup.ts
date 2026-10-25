import { Hono } from 'hono'
import { createReadStream, existsSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { db } from '../db.js'
import { BACKUP_DIR, backupPath, deleteLocal, listLocal, readManifest } from '../backup/local.js'
import { backupStatus, runBackup } from '../backup/run.js'
import { clearRemoteConfig, deleteRow, fetchRow, listRows, loadRemoteConfig, normalizeConfig, saveRemoteConfig, testConnection } from '../backup/remote.js'

export const backupRoute = new Hono()

/** 状态 + 本机清单（远端清单要连库，单独接口按需拉） */
backupRoute.get('/', (c) => c.json({ ...backupStatus(db), local: { ...backupStatus(db).local, files: listLocal() } }))

backupRoute.get('/local', (c) => c.json({ files: listLocal() }))

backupRoute.get('/local/:name/manifest', (c) => {
  const m = readManifest(c.req.param('name'))
  if (!m) return c.json({ error: '找不到这份备份或清单损坏' }, 404)
  return c.json(m)
})

backupRoute.get('/local/:name/download', (c) => {
  const p = backupPath(c.req.param('name'))
  if (!p || !existsSync(p)) return c.json({ error: '找不到这份备份' }, 404)
  return c.body(createReadStream(p) as any, 200, {
    'Content-Type': 'application/gzip',
    'Content-Disposition': 'attachment; filename="' + basename(p) + '"',
  })
})

backupRoute.delete('/local/:name', (c) => {
  const ok = deleteLocal(c.req.param('name'))
  return ok ? c.json({ ok: true }) : c.json({ error: '找不到这份备份' }, 404)
})

/** 立即备份：only=local / remote 可只跑一边 */
backupRoute.post('/run', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const only = body?.only === 'local' || body?.only === 'remote' ? body.only : undefined
  const report = await runBackup(db, { only })
  return c.json({ ok: !Object.values(report).some((r) => r && !r.ok), report, status: backupStatus(db) })
})

/** 远端：实时拉一次清单（连库，慢一点，页面点「刷新」才调） */
backupRoute.get('/remote', async (c) => {
  const cfg = loadRemoteConfig(db)
  if (!cfg) return c.json({ enabled: false, rows: [] })
  try {
    const rows = await listRows(cfg)
    return c.json({ enabled: true, rows })
  } catch (e) {
    return c.json({ enabled: true, rows: [], error: String((e as Error).message ?? e) })
  }
})

backupRoute.post('/remote/test', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const saved = loadRemoteConfig(db)
  try {
    const cfg = normalizeConfig({ ...(saved ?? {}), ...body, password: body?.password || saved?.password || '' })
    const r = await testConnection(cfg)
    return c.json({ ok: true, version: r.version })
  } catch (e) {
    return c.json({ ok: false, error: String((e as Error).message ?? e) }, 400)
  }
})

backupRoute.post('/remote/config', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  try {
    const cfg = saveRemoteConfig(db, body)
    const { password, ...rest } = cfg
    return c.json({ ok: true, config: { ...rest, hasPassword: true } })
  } catch (e) {
    return c.json({ ok: false, error: String((e as Error).message ?? e) }, 400)
  }
})

backupRoute.delete('/remote/config', (c) => {
  clearRemoteConfig(db)
  return c.json({ ok: true })
})

backupRoute.delete('/remote/:id', async (c) => {
  const cfg = loadRemoteConfig(db)
  if (!cfg) return c.json({ error: '还没配置远端库' }, 400)
  try {
    await deleteRow(cfg, c.req.param('id'))
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ error: String((e as Error).message ?? e) }, 500)
  }
})

/** 远端某份下载回本机：落到 data/backups/，之后就能像本机备份一样恢复 */
backupRoute.post('/remote/:id/download', async (c) => {
  const cfg = loadRemoteConfig(db)
  if (!cfg) return c.json({ error: '还没配置远端库' }, 400)
  try {
    const row = await fetchRow(cfg, c.req.param('id'))
    if (!row) return c.json({ error: '远端找不到这份备份' }, 404)
    const target = join(BACKUP_DIR, basename(row.filename))
    writeFileSync(target, row.data)
    return c.json({ ok: true, file: basename(row.filename), size: row.data.length })
  } catch (e) {
    return c.json({ error: String((e as Error).message ?? e) }, 500)
  }
})
