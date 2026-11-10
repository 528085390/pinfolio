// SigV4 签名：用 AWS 官方文档给出的样例做基准（独立可核对），再冻结一条我们自己的 PUT 快照防回退。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_SHA256,
  amzDate,
  canonicalQuery,
  canonicalUri,
  sha256Hex,
  signRequest,
  signingKey,
  uriEncode,
} from '../../server/storage/sigv4.js'

// —— 基准 1：AWS S3 文档「签名计算示例」里的 GET object ——
// https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
const DOC_CREDS = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 's3',
}

test('SigV4：AWS 文档里的 GET 示例，canonical request / string-to-sign / 签名全部对上', () => {
  const r = signRequest({
    method: 'GET',
    url: 'https://examplebucket.s3.amazonaws.com/test.txt',
    headers: { range: 'bytes=0-9' },
    payloadHash: EMPTY_SHA256,
    credentials: DOC_CREDS,
    now: new Date('2013-05-24T00:00:00Z'),
  })
  assert.equal(
    r.canonicalRequest,
    [
      'GET',
      '/test.txt',
      '',
      'host:examplebucket.s3.amazonaws.com',
      'range:bytes=0-9',
      'x-amz-content-sha256:' + EMPTY_SHA256,
      'x-amz-date:20130524T000000Z',
      '',
      'host;range;x-amz-content-sha256;x-amz-date',
      EMPTY_SHA256,
    ].join('\n'),
  )
  assert.equal(
    r.stringToSign,
    'AWS4-HMAC-SHA256\n20130524T000000Z\n20130524/us-east-1/s3/aws4_request\n' +
      '7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972',
  )
  assert.equal(r.signature, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')
  assert.equal(
    r.headers.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
      'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
      'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
  )
})

// —— 基准 2：我们真正会发的形状（PUT 到 OCI 兼容端点），冻结签名防回退 ——
test('SigV4：PUT 到 OCI 兼容端点的签名稳定', () => {
  const body = Buffer.from('hello pinfolio')
  const payload = sha256Hex(body)
  assert.equal(payload, '41d31ef1b51e6b5bc4ebb4ce0cfc39d3c37c96edbaf9e0c5ad767fc18442124e')
  const r = signRequest({
    method: 'PUT',
    url: 'https://nrx1ozdaernl.compat.objectstorage.ap-tokyo-1.oraclecloud.com/pinfolio/att/12.mp4',
    headers: { 'content-type': 'video/mp4' },
    payloadHash: payload,
    credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret-example', region: 'ap-tokyo-1' },
    now: new Date('2026-11-10T13:00:00Z'),
  })
  assert.equal(r.signature, 'e8f4b9a94050c1cad4531d351673289a6524351258d0f0bbbb8058b0018cb69e')
  assert.match(r.headers.authorization, /SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date/)
})

test('SigV4：同一输入两次签出同一个结果（可重放）', () => {
  const input = {
    method: 'DELETE',
    url: 'https://example.com/bucket/key.txt',
    credentials: DOC_CREDS,
    now: new Date('2026-01-02T03:04:05Z'),
  }
  assert.equal(signRequest(input).signature, signRequest(input).signature)
})

test('SigV4：content-length 不参与签名（交给 undici 按实际 body 算）', () => {
  const r = signRequest({
    method: 'PUT',
    url: 'https://example.com/b/k',
    headers: { 'content-length': '5', 'content-type': 'text/plain' },
    payloadHash: sha256Hex('hello'),
    credentials: DOC_CREDS,
    now: new Date('2026-01-02T03:04:05Z'),
  })
  assert.ok(!('content-length' in r.headers))
  assert.match(r.headers.authorization, /SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date/)
})

test('canonicalQuery：编码后按 key、再按 value 排序', () => {
  assert.equal(canonicalQuery('b=2&a=1&a=0'), 'a=0&a=1&b=2')
  assert.equal(canonicalQuery({ 'x y': 'a b' }), 'x%20y=a%20b')
  assert.equal(canonicalQuery(''), '')
  assert.equal(canonicalQuery(null), '')
})

test('uriEncode：RFC 3986，!\'()* 必须转义（SigV4 的经典坑）', () => {
  assert.equal(uriEncode("a b!'()*~"), 'a%20b%21%27%28%29%2A~')
  assert.equal(canonicalUri('/pinfolio/att/12.mp4'), '/pinfolio/att/12.mp4')
  assert.equal(canonicalUri('/'), '/')
})

test('amzDate：ISO → 20130524T000000Z（毫秒要丢掉）', () => {
  assert.equal(amzDate(new Date('2026-11-10T13:00:00.123Z')), '20261110T130000Z')
  assert.equal(amzDate(new Date('2013-05-24T00:00:00Z')), '20130524T000000Z')
})

test('signingKey：派生密钥长度 32 字节（HMAC-SHA256）', () => {
  assert.equal(signingKey('secret', '20130524', 'us-east-1', 's3').length, 32)
})
