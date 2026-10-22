// 采集端接入（server/metrics/onboard.ts）的纯逻辑：base → ingest 地址、单元/磁盘清单解析、安装命令拼装。
// 命令会原样贴到用户的终端里，所以这里钉死引号与参数顺序。
// 运行：pnpm test:unit
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildIngestUrl, parseUnits, parseDisks, shq, buildInstallCommand,
} from '../../server/metrics/onboard.js'

/* ---------------- buildIngestUrl ---------------- */

test('buildIngestUrl：/metrics/<token>/ → /metrics-ingest/<token>', () => {
  assert.equal(
    buildIngestUrl('https://203.0.113.10/metrics/c4d600a573d3/'),
    'https://203.0.113.10/metrics-ingest/c4d600a573d3',
  )
})

test('buildIngestUrl：结尾没有斜杠也认，多个斜杠也收敛', () => {
  assert.equal(buildIngestUrl('https://h/metrics/tok'), 'https://h/metrics-ingest/tok')
  assert.equal(buildIngestUrl('  https://h/metrics/tok///  '), 'https://h/metrics-ingest/tok')
})

test('buildIngestUrl：base 形状不对就抛错（不能悄悄拼出个错地址）', () => {
  assert.throws(() => buildIngestUrl(''), /base 为空/)
  assert.throws(() => buildIngestUrl('https://h/other/tok/'), /没有 \/metrics\/ 段/)
  assert.throws(() => buildIngestUrl('https://h/metrics/'), /没有 token/)
})

/* ---------------- parseUnits ---------------- */

test('parseUnits：空格 / 逗号分隔，去重，保持顺序', () => {
  assert.deepEqual(parseUnits(' nginx  app-api , nginx '), ['nginx', 'app-api'])
  assert.deepEqual(parseUnits('xray\tmemwatch\n'), ['xray', 'memwatch'])
})

test('parseUnits：空输入回空数组', () => {
  assert.deepEqual(parseUnits(''), [])
  assert.deepEqual(parseUnits('   '), [])
  assert.deepEqual(parseUnits(undefined), [])
})

test('parseUnits：非法单元名抛错（带上是哪个）', () => {
  assert.throws(() => parseUnits('nginx;rm -rf /'), /单元名只能用字母、数字、@ : . _ -/)
  assert.throws(() => parseUnits('ok bad/name'), /bad\/name/)
})

/* ---------------- parseDisks ---------------- */

test('parseDisks：空输入回落 /，去重', () => {
  assert.deepEqual(parseDisks(''), ['/'])
  assert.deepEqual(parseDisks(' / /mnt/data / '), ['/', '/mnt/data'])
})

test('parseDisks：相对路径 / 带空格抛错', () => {
  assert.throws(() => parseDisks('mnt/data'), /磁盘路径要以 \/ 开头/)
  assert.throws(() => parseDisks('/mnt/a b'), /磁盘路径要以 \/ 开头，且不能含空格/)
})

/* ---------------- 安装命令 ---------------- */

test('shq：单引号包起来，内部单引号转义', () => {
  assert.equal(shq('abc'), "'abc'")
  assert.equal(shq("a'b"), "'a'\\''b'")
})

test('buildInstallCommand：下载 + sudo 安装，参数顺序与引号固定', () => {
  const cmd = buildInstallCommand({
    installUrl: 'https://203.0.113.10/nm/node-metrics-install.sh',
    ingestUrl: 'https://203.0.113.10/metrics-ingest/tok',
    hostId: 'os',
    units: ['sing-box'],
    disks: ['/', '/mnt/data'],
  })
  assert.equal(
    cmd,
    "curl -fsSL 'https://203.0.113.10/nm/node-metrics-install.sh' -o /tmp/node-metrics-install.sh" +
    " && sudo bash /tmp/node-metrics-install.sh 'https://203.0.113.10/metrics-ingest/tok' 'os' 'sing-box' '/ /mnt/data'",
  )
})

test('buildInstallCommand：没有单元时第三个参数是空串（不能省，否则磁盘会顶到单元位）', () => {
  const cmd = buildInstallCommand({
    installUrl: 'https://h/nm.sh', ingestUrl: 'https://h/metrics-ingest/t', hostId: 'zz',
    units: [], disks: ['/'],
  })
  assert.ok(cmd.endsWith(" 'zz' '' '/'"))
})
