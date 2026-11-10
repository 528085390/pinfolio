// 存储入口：按环境变量决定本地磁盘还是对象存储，全局只算一次。
//
// 单测可以用 __setStorageForTests 注入假客户端（不联网、不碰真桶）。

import { attachmentQuotaBytes, readStorageConfig, type StorageConfig } from './config.js'
import { createS3Client, type S3Client } from './s3.js'

export type { StorageConfig } from './config.js'
export { attachmentQuotaBytes, readStorageConfig, DEFAULT_QUOTA_BYTES } from './config.js'
export { S3Error, createS3Client } from './s3.js'

export type Storage = { config: StorageConfig; client: S3Client | null }

let cached: Storage | null = null
let injected: Storage | null | undefined

function build(): Storage {
  const config = readStorageConfig()
  return { config, client: config.driver === 's3' ? createS3Client(config) : null }
}

/** 当前存储（惰性算一次；环境变量在进程生命周期内不变） */
export function storage(): Storage {
  if (injected !== undefined) return injected as Storage
  if (!cached) cached = build()
  return cached
}

/** 附件总量上限（字节） */
export function quotaBytes(): number {
  return attachmentQuotaBytes()
}

/** 测试用：注入一个假存储（传 null 表示「强制本地磁盘」） */
export function __setStorageForTests(value: Storage | null): void {
  injected = value
}

/** 测试用：恢复成按环境变量算 */
export function __resetStorageForTests(): void {
  injected = undefined
  cached = null
}
