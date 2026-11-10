// AWS Signature V4：纯函数、只依赖 node:crypto。
//
// 为什么不引 @aws-sdk/client-s3：
//   ① 仓库一贯零重依赖（tar / gzip / 备份都是手写 + 单测）；
//   ② AWS SDK v3 默认给 PUT 加 x-amz-checksum-*，OCI 的 S3 兼容层会拒；
//   ③ 签名是纯计算，比 SDK 更好测（tests/unit/sigv4.test.mts）。
//
// 只实现我们要用的部分：**头部签名**（不是预签名 URL）、路径风格、payload 整块哈希。

import { createHash, createHmac } from 'node:crypto'

export type SigV4Credentials = {
  accessKeyId: string
  secretAccessKey: string
  /** 例如 ap-tokyo-1 / auto（R2 填 auto） */
  region: string
  /** 默认 s3 */
  service?: string
}

export const ALGORITHM = 'AWS4-HMAC-SHA256'

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** 空请求体的哈希（GET / HEAD / DELETE 用） */
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

export function hmacSha256(key: string | Uint8Array, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

/**
 * RFC 3986 转义：encodeURIComponent 不转义 !'()* ，而这四个在 SigV4 的
 * canonical query 里必须转义（坑：少转一个字符，签名就整条不对，但报错只说 SignatureDoesNotMatch）。
 */
export function uriEncode(s: string): string {
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

/** canonical URI：逐段转义、不二次编码（S3 的规矩：路径已经在 URL 里编好一次了） */
export function canonicalUri(path: string): string {
  const raw = String(path || '/')
  if (raw === '/' || raw === '') return '/'
  return raw
    .split('/')
    .map((seg) => uriEncode(seg))
    .join('/')
}

/** canonical query：先编码再按（编码后的）key / value 排序 */
export function canonicalQuery(query: string | Record<string, string> | undefined | null): string {
  const pairs: Array<[string, string]> = []
  if (typeof query === 'string') {
    for (const part of query.replace(/^\?/, '').split('&')) {
      if (!part) continue
      const i = part.indexOf('=')
      pairs.push(i < 0 ? [part, ''] : [part.slice(0, i), part.slice(i + 1)])
    }
  } else if (query) {
    for (const [k, v] of Object.entries(query)) pairs.push([k, String(v)])
  }
  const enc = pairs.map(([k, v]) => [uriEncode(k), uriEncode(v)] as [string, string])
  enc.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
  return enc.map(([k, v]) => k + '=' + v).join('&')
}

/** 20150830T123600Z */
export function amzDate(now: Date = new Date()): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export function dateStamp(amz: string): string {
  return amz.slice(0, 8)
}

export function signingKey(secretAccessKey: string, stamp: string, region: string, service: string): Buffer {
  const kDate = hmacSha256('AWS4' + secretAccessKey, stamp)
  const kRegion = hmacSha256(kDate, region)
  const kService = hmacSha256(kRegion, service)
  return hmacSha256(kService, 'aws4_request')
}

export type SignInput = {
  method: string
  /** 完整 URL（可带 query） */
  url: string
  headers?: Record<string, string>
  /** 请求体摘要（hex）。GET / HEAD / DELETE 传 EMPTY_SHA256 或省略 */
  payloadHash?: string
  credentials: SigV4Credentials
  now?: Date
}

export type SignedRequest = {
  headers: Record<string, string>
  canonicalRequest: string
  stringToSign: string
  signature: string
}

/**
 * 算出要补在请求上的头：x-amz-date / x-amz-content-sha256 / authorization。
 * 返回完整可发送的头（值都已就位），调用方直接拿去发。
 */
export function signRequest(input: SignInput): SignedRequest {
  const service = input.credentials.service || 's3'
  const now = input.now ?? new Date()
  const date = amzDate(now)
  const stamp = dateStamp(date)
  const payloadHash = input.payloadHash || EMPTY_SHA256

  const url = new URL(input.url)
  // 头名一律小写参与签名；发给服务端时大小写无所谓
  const headers: Record<string, string> = {}
  headers['host'] = url.host
  for (const [k, v] of Object.entries(input.headers || {})) headers[k.toLowerCase()] = String(v)
  if (!headers['x-amz-date']) headers['x-amz-date'] = date
  headers['x-amz-content-sha256'] = payloadHash

  // content-length 不参与签名：undici 自己会按实际 body 算，签进去反而容易不一致
  delete headers['content-length']

  const names = Object.keys(headers).sort()
  const canonicalHeaders = names.map((n) => n + ':' + String(headers[n]).trim().replace(/\s+/g, ' ') + '\n').join('')
  const signedHeaders = names.join(';')

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri(url.pathname),
    canonicalQuery(url.search),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const scope = stamp + '/' + input.credentials.region + '/' + service + '/aws4_request'
  const stringToSign = [ALGORITHM, headers['x-amz-date'], scope, sha256Hex(canonicalRequest)].join('\n')
  const key = signingKey(input.credentials.secretAccessKey, stamp, input.credentials.region, service)
  const signature = createHmac('sha256', key).update(stringToSign, 'utf8').digest('hex')

  return {
    headers: {
      ...headers,
      authorization:
        ALGORITHM +
        ' Credential=' + input.credentials.accessKeyId + '/' + scope +
        ', SignedHeaders=' + signedHeaders +
        ', Signature=' + signature,
    },
    canonicalRequest,
    stringToSign,
    signature,
  }
}
