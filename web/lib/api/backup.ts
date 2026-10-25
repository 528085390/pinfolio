import { request } from './http'

// 备份（spec 05）：本机 tar.gz + 远程 MySQL/PostgreSQL，见 server/routes/backup.ts
export type BackupState = { ok: boolean; at: string; detail?: string; error?: string; count?: number }
export type LocalFile = { name: string; size: number; mtime: string }
export type RemoteConfigView = {
  type: 'mysql' | 'postgres'
  host: string
  port: number
  database: string
  user: string
  table: string
  hasPassword: boolean
}
export type BackupStatus = {
  local: { enabled: boolean; count: number; state: BackupState | null; files: LocalFile[] }
  remote: { enabled: boolean; state: BackupState | null; config: RemoteConfigView | null }
}
export type RemoteRow = { id: string; filename: string; created_at: string; size: number; sha256: string }
export type Manifest = {
  instanceId: string
  createdAt: string
  members: { name: string; size: number; sha256: string }[]
}
export type RemoteInput = {
  type: 'mysql' | 'postgres'
  host: string
  port: number
  database: string
  user: string
  password?: string
  table: string
}

export const backupApi = {
  status: () => request<BackupStatus>('/backup'),
  run: (only?: 'local' | 'remote') =>
    request<{ ok: boolean; report: Record<string, BackupState>; status: BackupStatus }>('/backup/run', {
      method: 'POST',
      body: JSON.stringify({ only }),
    }),
  manifest: (name: string) => request<Manifest>('/backup/local/' + encodeURIComponent(name) + '/manifest'),
  removeLocal: (name: string) =>
    request<{ ok: boolean }>('/backup/local/' + encodeURIComponent(name), { method: 'DELETE' }),
  remoteRows: () => request<{ enabled: boolean; rows: RemoteRow[]; error?: string }>('/backup/remote'),
  testRemote: (cfg: Partial<RemoteInput>) =>
    request<{ ok: boolean; version?: string; error?: string }>('/backup/remote/test', {
      method: 'POST',
      body: JSON.stringify(cfg),
    }),
  saveRemote: (cfg: Partial<RemoteInput>) =>
    request<{ ok: boolean; config: RemoteConfigView }>('/backup/remote/config', {
      method: 'POST',
      body: JSON.stringify(cfg),
    }),
  clearRemote: () => request<{ ok: boolean }>('/backup/remote/config', { method: 'DELETE' }),
  removeRemote: (id: string) => request<{ ok: boolean }>('/backup/remote/' + encodeURIComponent(id), { method: 'DELETE' }),
  fetchRemote: (id: string) =>
    request<{ ok: boolean; file: string; size: number }>('/backup/remote/' + encodeURIComponent(id) + '/download', {
      method: 'POST',
      body: '{}',
    }),
}
