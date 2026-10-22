import { all, get, nowIso, run } from '../db.js'

// host_metrics 的读写：写入按 (host, ts) 幂等，重复拉同一个文件不会长出重复行。
export type StoredSample = { host: string; ts: number; data: any; received_at: string }

export function saveSample(host: string, ts: number, data: any) {
  run(
    'INSERT OR REPLACE INTO host_metrics (host, ts, data, received_at) VALUES (?, ?, ?, ?)',
    host,
    ts,
    JSON.stringify(data),
    nowIso(),
  )
}

/** 每台机最新一行（SQL 里按 host 分组取 max(ts)，一次查完）。 */
export function latestSamples(): Map<string, StoredSample> {
  const rows = all<StoredSample>(
    'SELECT h.host, h.ts, h.data, h.received_at FROM host_metrics h ' +
      'JOIN (SELECT host, MAX(ts) AS mts FROM host_metrics GROUP BY host) m ' +
      'ON h.host = m.host AND h.ts = m.mts',
  )
  const map = new Map<string, StoredSample>()
  for (const r of rows) {
    try {
      map.set(r.host, { ...r, data: JSON.parse(r.data) })
    } catch {
      // 单行 JSON 坏了就跳过，不影响别的机器
    }
  }
  return map
}

/** 24 小时曲线：返回 [ts, cpu%, 内存%] 三元组，前端画 sparkline 用。 */
export function seriesSince(host: string, sinceTs: number): [number, number, number][] {
  const rows = all<{ ts: number; data: string }>(
    'SELECT ts, data FROM host_metrics WHERE host = ? AND ts >= ? ORDER BY ts ASC',
    host,
    sinceTs,
  )
  const out: [number, number, number][] = []
  for (const r of rows) {
    try {
      const d = JSON.parse(r.data)
      out.push([r.ts, Number(d?.cpu_pct ?? 0), Number(d?.mem?.used_pct ?? 0)])
    } catch {
      // 忽略坏行
    }
  }
  return out
}

export function pruneOld(days = 30): number {
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400
  return run('DELETE FROM host_metrics WHERE ts < ?', cutoff).changes
}

/** 删除某台机的全部历史样本（删主机时勾了「同时删掉历史」才会走到这里）。 */
export function deleteSamples(host: string): number {
  return run('DELETE FROM host_metrics WHERE host = ?', host).changes
}

export function sampleCount(): number {
  return get<{ n: number }>('SELECT COUNT(*) AS n FROM host_metrics')?.n ?? 0
}
