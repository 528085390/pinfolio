// S3 兼容对象存储客户端（OCI Object Storage / Cloudflare R2 / MinIO 都走这里）。
//
// 只实现附件要用的四个动作：put / get（可带 Range）/ head / delete。
// 路径风格 URL：<endpoint>/<bucket>/<key> —— OCI 的兼容端点就是按这个形态给的。
//
// 注意：这里**不重试**。附件上传失败要让用户立刻看到，静默重试只会在 100 MB 上耗时更久。

import { fetch } from 'undici'
import type { StorageConfig } from './config.js'
import { EMPTY_SHA256, sha256Hex, signRequest } from './sigv4.js'

export class S3Error extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'S3Error'
    this.status = status
    this.code = code
  }
}

export type S3GetResult = {
  status: number
  headers: Record<string, string>
  body: ReadableStream<Uint8Array> | null
}

export type S3Client = {
  bucket: string
  endpoint: string
  objectUrl(key: string): string
  putObject(key: string, body: Uint8Array, contentType: string, now?: Date): Promise<{ etag: string }>
  getObject(key: string, range?: string, now?: Date): Promise<S3GetResult>
  headObject(key: string, now?: Date): Promise<{ size: number; contentType: string } | null>
  deleteObject(key: string, now?: Date): Promise<void>
}

/** 逐段转义对象键（键是我们自己生成的 id.ext，这里只是防手滑） */
export function encodeKey(key: string): string {
  return String(key)
    .replace(/^\/+/, '')
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

function errorCodeFromXml(text: string): string {
  const m = /<Code>([^<]+)<\/Code>/.exec(text)
  return m ? m[1] : ''
}

function errorMessageFromXml(text: string): string {
  const m = /<Message>([^<]*)<\/Message>/.exec(text)
  return m ? m[1] : text.slice(0, 200)
}

const DEFAULT_TIMEOUT_MS = 120_000

export function createS3Client(cfg: StorageConfig, timeoutMs: number = DEFAULT_TIMEOUT_MS): S3Client {
  if (cfg.driver !== 's3') throw new Error('createS3Client 只接受 driver=s3 的配置')
  const endpoint = cfg.endpoint.replace(/\/+$/, '')
  const creds = {
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: cfg.region,
    service: 's3',
  }

  function objectUrl(key: string): string {
    return endpoint + '/' + cfg.bucket + '/' + encodeKey(key)
  }

  function signedHeaders(method: string, url: string, extra: Record<string, string>, payloadHash: string, now?: Date) {
    return signRequest({ method, url, headers: extra, payloadHash, credentials: creds, now }).headers
  }

  async function failed(res: { status: number; text(): Promise<string> }, what: string): Promise<never> {
    let text = ''
    try { text = await res.text() } catch { /* ignore */ }
    const code = errorCodeFromXml(text)
    const msg = errorMessageFromXml(text)
    throw new S3Error(res.status, code || 'S3Error', what + ' 失败：' + res.status + (code ? ' ' + code : '') + (msg ? ' ' + msg : ''))
  }

  return {
    bucket: cfg.bucket,
    endpoint,
    objectUrl,

    async putObject(key, body, contentType, now) {
      const url = objectUrl(key)
      const hash = sha256Hex(body)
      const headers = signedHeaders('PUT', url, { 'content-type': contentType }, hash, now)
      const res = await fetch(url, {
        method: 'PUT',
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) await failed(res, '上传对象')
      return { etag: String(res.headers.get('etag') ?? '') }
    },

    async getObject(key, range, now) {
      const url = objectUrl(key)
      const extra: Record<string, string> = {}
      // Range 不参与签名（未签名的头照样能发），省得为每种区间算一次签名
      if (range) extra['range'] = range
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(extra)) if (k !== 'range') out[k] = v
      const headers = signedHeaders('GET', url, out, EMPTY_SHA256, now)
      if (range) headers['range'] = range
      const res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok && res.status !== 206) await failed(res, '读取对象')
      const h: Record<string, string> = {}
      res.headers.forEach((v, k) => { h[k.toLowerCase()] = v })
      return { status: res.status, headers: h, body: res.body as ReadableStream<Uint8Array> | null }
    },

    async headObject(key, now) {
      const url = objectUrl(key)
      const headers = signedHeaders('HEAD', url, {}, EMPTY_SHA256, now)
      const res = await fetch(url, { method: 'HEAD', headers, signal: AbortSignal.timeout(timeoutMs) })
      if (res.status === 404) return null
      if (!res.ok) await failed(res, '查询对象')
      return {
        size: Number(res.headers.get('content-length') ?? 0),
        contentType: String(res.headers.get('content-type') ?? ''),
      }
    },

    async deleteObject(key, now) {
      const url = objectUrl(key)
      const headers = signedHeaders('DELETE', url, {}, EMPTY_SHA256, now)
      const res = await fetch(url, { method: 'DELETE', headers, signal: AbortSignal.timeout(timeoutMs) })
      // 已经不在了也算删成功：清扫要能反复跑
      if (!res.ok && res.status !== 404) await failed(res, '删除对象')
    },
  }
}
