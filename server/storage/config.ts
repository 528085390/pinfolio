// 对象存储配置：只读环境变量，纯函数（单测直接打这里）。
//
// 四个必填项（endpoint / bucket / accessKeyId / secretAccessKey）齐了才算 s3，
// 少一个就回落成本地磁盘 —— 桌面版和没配对象存储的实例行为一点不变。

export type StorageDriver = 'local' | 's3'

export type StorageConfig = {
  driver: StorageDriver
  /** 例如 https://nrx1ozdaernl.compat.objectstorage.ap-tokyo-1.oraclecloud.com */
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** 对象键前缀，归一成「不以 / 开头、以 / 结尾」，空串表示不加前缀 */
  prefix: string
}

/** 默认总量上限 15 GB：Always Free 的 20 GB 要和 restic 备份共用，给那边留 5 GB */
export const DEFAULT_QUOTA_BYTES = 15 * 1024 * 1024 * 1024

/** 把 'att' / '/att/' / 'att/' 都归一成 'att/'；空值归一成 '' */
export function normalizePrefix(raw: string | undefined | null): string {
  const s = String(raw ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '')
  return s ? s + '/' : ''
}

export function readStorageConfig(env: Record<string, string | undefined> = process.env): StorageConfig {
  const endpoint = String(env.S3_ENDPOINT ?? '').trim()
  const bucket = String(env.S3_BUCKET ?? '').trim()
  const accessKeyId = String(env.S3_ACCESS_KEY_ID ?? '').trim()
  const secretAccessKey = String(env.S3_SECRET_ACCESS_KEY ?? '').trim()
  const forced = String(env.S3_DRIVER ?? '').trim().toLowerCase()
  const complete = Boolean(endpoint && bucket && accessKeyId && secretAccessKey)
  const driver: StorageDriver = forced === 'local' ? 'local' : complete ? 's3' : 'local'
  return {
    driver,
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: String(env.S3_REGION ?? '').trim() || 'auto',
    prefix: normalizePrefix(env.S3_PREFIX ?? 'att/'),
  }
}

/** 附件总量上限（字节）：ATTACHMENTS_QUOTA_BYTES 非正数或解析失败就用默认值 */
export function attachmentQuotaBytes(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.ATTACHMENTS_QUOTA_BYTES ?? '')
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_QUOTA_BYTES
  return Math.floor(n)
}
