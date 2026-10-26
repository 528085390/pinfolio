// 备份编排：打一个包，写本机文件 + 传远端库，两边各自记状态，互不影响。
import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { getSetting, setSetting } from '../auth/store.js'
import { instanceId } from '../tunnel-core.js'
import { archiveHeartbeats, buildPackage, listLocal, pruneLocal, writeLocal, KEEP } from './local.js'
import { loadRemoteConfig, pruneRows, upload, type RemoteConfig } from './remote.js'
import { t } from '../i18n.js'

export type DestState = { ok: boolean; at: string; detail?: string; error?: string; count?: number }

const LOCAL_STATE = 'backup.local.state'
const REMOTE_STATE = 'backup.remote.state'

export function localEnabled(): boolean {
  return process.env.BACKUP !== '0'
}

function readState(db: DatabaseSync, key: string): DestState | null {
  const raw = getSetting(db, key)
  if (!raw) return null
  try { return JSON.parse(raw) as DestState } catch { return null }
}

function writeState(db: DatabaseSync, key: string, s: DestState) {
  setSetting(db, key, JSON.stringify(s))
}

export type RunReport = { local?: DestState; remote?: DestState }

/** 跑一次备份。only 用来单独触发某一个目的地（页面上两个按钮） */
export async function runBackup(db: DatabaseSync, opts: { only?: 'local' | 'remote'; date?: Date } = {}): Promise<RunReport> {
  const now = opts.date ?? new Date()
  const at = now.toISOString()
  const id = instanceId(db)
  const report: RunReport = {}

  // 审计归档先写（和 14 份保留无关；一天只写一次）
  try { archiveHeartbeats(now) } catch (e) { console.error('[backup] 心跳归档失败:', String(e)) }

  let pkg: { name: string; data: Buffer } | null = null
  const needLocal = opts.only !== 'remote' && localEnabled()
  const remoteCfg = opts.only === 'local' ? null : loadRemoteConfig(db)
  if (needLocal || remoteCfg) {
    try {
      pkg = await buildPackage(db, now, id)
    } catch (e) {
      const err = t('打包失败：') + String((e as Error).message ?? e)
      if (needLocal) report.local = { ok: false, at, error: err }
      if (remoteCfg) report.remote = { ok: false, at, error: err }
    }
  }

  if (needLocal && pkg) {
    try {
      const { size } = writeLocal(pkg)
      const removed = pruneLocal(KEEP)
      const count = listLocal().length
      const s: DestState = { ok: true, at, detail: pkg.name + ' · ' + Math.round(size / 1024) + ' KB' + (removed.length ? t(' · 清理 {n} 份', { n: removed.length }) : ''), count }
      writeState(db, LOCAL_STATE, s)
      report.local = s
    } catch (e) {
      const s: DestState = { ok: false, at, error: String((e as Error).message ?? e) }
      writeState(db, LOCAL_STATE, s)
      report.local = s
    }
  }

  if (remoteCfg && pkg) {
    try {
      const sha = createHash('sha256').update(pkg.data).digest('hex')
      await upload(remoteCfg, { id: randomUUID(), instanceId: id, filename: pkg.name, createdAt: at, sha256: sha, data: pkg.data })
      const pruned = await pruneRows(remoteCfg, KEEP)
      const s: DestState = { ok: true, at, detail: pkg.name + ' · ' + Math.round(pkg.data.length / 1024) + ' KB' + (pruned ? t(' · 清理 {n} 份', { n: pruned }) : '') }
      writeState(db, REMOTE_STATE, s)
      report.remote = s
    } catch (e) {
      const s: DestState = { ok: false, at, error: String((e as Error).message ?? e) }
      writeState(db, REMOTE_STATE, s)
      report.remote = s
    }
  }

  return report
}

export type Status = {
  local: { enabled: boolean; count: number; state: DestState | null }
  remote: { enabled: boolean; state: DestState | null; config: (Omit<RemoteConfig, 'password'> & { hasPassword: boolean }) | null }
}

export function backupStatus(db: DatabaseSync): Status {
  const cfg = loadRemoteConfig(db)
  const { password, ...rest } = cfg ?? ({} as RemoteConfig)
  return {
    local: { enabled: localEnabled(), count: listLocal().length, state: readState(db, LOCAL_STATE) },
    remote: {
      enabled: !!cfg,
      state: readState(db, REMOTE_STATE),
      config: cfg ? { ...rest, hasPassword: !!password } : null,
    },
  }
}
