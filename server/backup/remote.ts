// 远程数据库目的地：把同一份 tar.gz 写进 MySQL / PostgreSQL 的一行。
// 驱动懒加载——不用远端模式就不会 import mysql2 / pg。
import type { DatabaseSync } from 'node:sqlite'
import { getSetting, setSetting, deleteSetting } from '../auth/store.js'
import { encryptText, isEncrypted, readSecret } from '../secrets/crypto.js'
import { loadKey } from '../secrets/key.js'
import { DATA_DIR } from '../db.js'
import { t } from '../i18n.js'

export type RemoteType = 'mysql' | 'postgres'

export type RemoteConfig = {
  type: RemoteType
  host: string
  port: number
  database: string
  user: string
  /** 内存里是明文，落库时走 03 的加密 */
  password: string
  table: string
}

export type RemoteRow = { id: string; filename: string; created_at: string; size: number; sha256: string }

const KEY = 'backup.remote'
const TABLE_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

export const DEFAULT_TABLE = 'pinfolio_backups'

export function normalizeConfig(input: Partial<RemoteConfig>): RemoteConfig {
  const type = input.type === 'postgres' ? 'postgres' : 'mysql'
  const host = String(input.host ?? '').trim()
  const database = String(input.database ?? '').trim()
  const user = String(input.user ?? '').trim()
  const table = String(input.table ?? DEFAULT_TABLE).trim() || DEFAULT_TABLE
  if (!host) throw new Error(t('地址不能为空'))
  if (!database) throw new Error(t('库名不能为空'))
  if (!user) throw new Error(t('用户名不能为空'))
  if (!TABLE_RE.test(table)) throw new Error(t('表名只能用字母、数字、下划线'))
  const defPort = type === 'postgres' ? 5432 : 3306
  const port = Number(input.port ?? defPort)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(t('端口不对'))
  return { type, host, port, database, user, password: String(input.password ?? ''), table }
}

export function loadRemoteConfig(db: DatabaseSync): RemoteConfig | null {
  const raw = getSetting(db, KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as RemoteConfig
    const key = loadKey(DATA_DIR)
    return { ...parsed, password: readSecret(parsed.password ?? '', key) }
  } catch {
    return null
  }
}

/** 保存配置：密码没填就沿用原来那份（页面上只显示「已设置」，不回显） */
export function saveRemoteConfig(db: DatabaseSync, input: Partial<RemoteConfig>): RemoteConfig {
  const prev = loadRemoteConfig(db)
  const cfg = normalizeConfig({ ...input, password: input.password || prev?.password || '' })
  if (!cfg.password) throw new Error(t('密码不能为空'))
  const key = loadKey(DATA_DIR)
  setSetting(db, KEY, JSON.stringify({ ...cfg, password: isEncrypted(cfg.password) ? cfg.password : encryptText(cfg.password, key) }))
  return cfg
}

export function clearRemoteConfig(db: DatabaseSync): void {
  deleteSetting(db, KEY)
}

type Conn = {
  query: (sql: string, params?: unknown[]) => Promise<any>
  close: () => Promise<void>
}

/** 打开一个连接（用完必须 close）；驱动缺失时给出可读的错 */
async function connect(cfg: RemoteConfig): Promise<Conn> {
  if (cfg.type === 'postgres') {
    let pg: any
    try {
      pg = await import('pg')
    } catch {
      throw new Error(t('缺少 pg 驱动（pnpm add pg）'))
    }
    const client = new pg.Client({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database, connectionTimeoutMillis: 8000 })
    await client.connect()
    return {
      query: async (sql, params) => (await client.query(sql, params as any[])).rows,
      close: async () => { await client.end() },
    }
  }
  let mysql: any
  try {
    mysql = await import('mysql2/promise')
  } catch {
    throw new Error(t('缺少 mysql2 驱动（pnpm add mysql2）'))
  }
  const conn = await mysql.createConnection({
    host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database,
    connectTimeout: 8000, supportBigNumbers: true,
  })
  return {
    query: async (sql, params) => { const [rows] = await conn.query(sql, params ?? []); return rows },
    close: async () => { await conn.end() },
  }
}

async function withConn<T>(cfg: RemoteConfig, fn: (c: Conn) => Promise<T>): Promise<T> {
  const c = await connect(cfg)
  try {
    return await fn(c)
  } finally {
    try { await c.close() } catch { /* ignore */ }
  }
}

export async function testConnection(cfg: RemoteConfig): Promise<{ ok: true; version: string }> {
  return withConn(cfg, async (c) => {
    const rows = await c.query(cfg.type === 'postgres' ? 'SELECT version() AS v' : 'SELECT VERSION() AS v')
    const v = Array.isArray(rows) ? (rows[0]?.v ?? rows[0]?.VERSION ?? '') : ''
    return { ok: true as const, version: String(v).slice(0, 120) }
  })
}

const BLOB_TYPE = { mysql: 'LONGBLOB', postgres: 'BYTEA' } as const
const ID_TYPE = { mysql: 'VARCHAR(36)', postgres: 'VARCHAR(36)' } as const

export async function ensureTable(cfg: RemoteConfig): Promise<void> {
  const tbl = cfg.table
  await withConn(cfg, async (c) => {
    await c.query(
      'CREATE TABLE IF NOT EXISTS ' + tbl + ' (' +
        'id ' + ID_TYPE[cfg.type] + ' PRIMARY KEY, ' +
        'instance_id VARCHAR(36) NOT NULL, ' +
        'filename VARCHAR(128) NOT NULL, ' +
        'created_at VARCHAR(32) NOT NULL, ' + // 存 ISO 字符串：MySQL 的 DATETIME 不吃 'T…Z'，PG 又有时区差异
        'size BIGINT NOT NULL, ' +
        'sha256 CHAR(64) NOT NULL, ' +
        'payload ' + BLOB_TYPE[cfg.type] + ' NOT NULL)',
    )
  })
}

export async function upload(cfg: RemoteConfig, row: { id: string; instanceId: string; filename: string; createdAt: string; sha256: string; data: Buffer }): Promise<void> {
  await ensureTable(cfg)
  await withConn(cfg, async (c) => {
    const ph = cfg.type === 'postgres' ? ['$1', '$2', '$3', '$4', '$5', '$6', '$7'] : ['?', '?', '?', '?', '?', '?', '?']
    await c.query(
      'INSERT INTO ' + cfg.table + ' (id, instance_id, filename, created_at, size, sha256, payload) VALUES (' + ph.join(', ') + ')',
      [row.id, row.instanceId, row.filename, row.createdAt, row.data.length, row.sha256, row.data],
    )
    // 回读校验：传上去的和本地的必须逐字节一致
    const back = await c.query('SELECT size, sha256 FROM ' + cfg.table + ' WHERE id = ' + (cfg.type === 'postgres' ? '$1' : '?'), [row.id])
    const got = Array.isArray(back) ? back[0] : undefined
    if (!got || Number(got.size) !== row.data.length || String(got.sha256) !== row.sha256) {
      throw new Error(t('远端回读校验失败（大小或 sha256 不一致）'))
    }
  })
}

export async function listRows(cfg: RemoteConfig): Promise<RemoteRow[]> {
  return withConn(cfg, async (c) => {
    const rows = await c.query('SELECT id, filename, created_at, size, sha256 FROM ' + cfg.table + ' ORDER BY created_at DESC')
    return (Array.isArray(rows) ? rows : []).map((r: any) => ({
      id: String(r.id),
      filename: String(r.filename),
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      size: Number(r.size),
      sha256: String(r.sha256),
    }))
  })
}

export async function fetchRow(cfg: RemoteConfig, id: string): Promise<{ filename: string; data: Buffer } | null> {
  return withConn(cfg, async (c) => {
    const rows = await c.query('SELECT filename, payload FROM ' + cfg.table + ' WHERE id = ' + (cfg.type === 'postgres' ? '$1' : '?'), [id])
    const r = Array.isArray(rows) ? rows[0] : undefined
    if (!r) return null
    return { filename: String(r.filename), data: Buffer.from(r.payload) }
  })
}

export async function deleteRow(cfg: RemoteConfig, id: string): Promise<void> {
  await withConn(cfg, async (c) => {
    await c.query('DELETE FROM ' + cfg.table + ' WHERE id = ' + (cfg.type === 'postgres' ? '$1' : '?'), [id])
  })
}

/** 保留最近 keep 份，多的删掉（按 created_at 倒序） */
export async function pruneRows(cfg: RemoteConfig, keep = 14): Promise<number> {
  const rows = await listRows(cfg)
  const expired = rows.slice(keep)
  for (const r of expired) await deleteRow(cfg, r.id)
  return expired.length
}
