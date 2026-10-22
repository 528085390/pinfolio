#!/usr/bin/env node
/**
 * build-install.mjs —— 把 tools/node-metrics 的四件套压成**单文件安装器**。
 *
 * 为什么要有它：install.sh 依赖同目录的 node-metrics.sh / .service / .timer（第 29、41、42 行
 * install "$SRC/..."），所以不能 curl | bash 单文件装。服务器上又访问不到本机 pinfolio，
 * 于是把四个文件内联成一个 node-metrics-install.sh，托管在 my-server 的 /var/www/metrics/<token>/
 * （nginx 的 GET 段），新机器一条 curl 就能装。
 *
 * 用法：node tools/node-metrics/build-install.mjs [--check]
 *   --check  只校验已生成的产物与源文件是否一致（CI / 提交前用），不写文件
 *
 * 生成物带「源文件指纹」注释：改了四件套但忘了重新打包，--check 会报错。
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, 'node-metrics-install.sh')

/** 参与打包的文件（顺序即写入临时目录的顺序） */
export const PARTS = ['install.sh', 'node-metrics.sh', 'node-metrics.service', 'node-metrics.timer']

/** 每个文件用独立的 heredoc 分隔符，防止正文里出现分隔符把脚本截断 */
export function delimiterFor(name) {
  return 'NODE_METRICS__' + name.replace(/[^A-Za-z0-9]/g, '_').toUpperCase() + '__EOF'
}

/** 源文件指纹：只对参与打包的内容做 sha256，用来发现「改了源文件忘了重新打包」 */
export function fingerprint(files) {
  const h = createHash('sha256')
  for (const name of PARTS) h.update(name + '\0' + files[name] + '\0')
  return h.digest('hex').slice(0, 16)
}

/**
 * 生成单文件安装器。
 * @param {Record<string, string>} files 四个源文件的正文（键为 PARTS 里的文件名）
 * @returns {string} 完整的 node-metrics-install.sh
 */
export function buildInstaller(files) {
  for (const name of PARTS) {
    if (typeof files[name] !== 'string') throw new Error('缺少源文件：' + name)
    const d = delimiterFor(name)
    // 分隔符必须独占一行且源文件里不能出现，否则 heredoc 会提前结束
    if (files[name].split('\n').some((line) => line === d)) {
      throw new Error('源文件里出现了 heredoc 分隔符：' + name)
    }
  }
  const fp = fingerprint(files)
  const lines = [
    '#!/bin/bash',
    '# node-metrics-install.sh —— 单文件安装器（自动生成，别手改）',
    '#',
    '# 由 tools/node-metrics/build-install.mjs 从 install.sh + node-metrics.sh +',
    '# node-metrics.service + node-metrics.timer 内联生成；改那四个文件后重新打包：',
    '#   node tools/node-metrics/build-install.mjs',
    '#',
    '# 用法（在目标机上，需要 root）：',
    '#   curl -fsSL <本文件地址> -o /tmp/node-metrics-install.sh',
    '#   sudo bash /tmp/node-metrics-install.sh <METRICS_URL> <HOST_ID> [WATCH_UNITS] [DISK_PATHS]',
    '#',
    '# 参数含义与 install.sh 完全一致：METRICS_URL 形如 https://<host>/metrics-ingest/<TOKEN>',
    '# 源文件指纹：' + fp,
    'set -euo pipefail',
    '',
    'if [ "$(id -u)" != "0" ]; then',
    '  echo "需要 root：sudo bash $0 <METRICS_URL> <HOST_ID> [WATCH_UNITS] [DISK_PATHS]" >&2',
    '  exit 2',
    'fi',
    '',
    'SRC="$(mktemp -d)"',
    'trap \'rm -rf "$SRC"\' EXIT',
    '',
  ]
  for (const name of PARTS) {
    lines.push('# ── ' + name + ' ──')
    lines.push('cat > "$SRC/' + name + '" <<\'' + delimiterFor(name) + '\'')
    lines.push(files[name].replace(/\n$/, ''))
    lines.push(delimiterFor(name))
    lines.push('')
  }
  lines.push('chmod 0755 "$SRC/install.sh" "$SRC/node-metrics.sh"')
  // 不用 exec：exec 会跳过 trap，临时目录留在 /tmp 里；这里跑完让 trap 清掉
  lines.push('status=0')
  lines.push('bash "$SRC/install.sh" "$@" || status=$?')
  lines.push('exit "$status"')
  lines.push('')
  return lines.join('\n')
}

/**
 * 从生成物里把每个 heredoc 的正文抽出来（校验用）。
 * @param {string} text 生成物正文
 * @returns {Record<string, string>} 文件名 → 正文
 */
export function extractParts(text) {
  const out = {}
  for (const name of PARTS) {
    const d = delimiterFor(name)
    const start = text.indexOf('cat > "$SRC/' + name + '" <<\'' + d + '\'\n')
    if (start < 0) throw new Error('生成物里找不到 ' + name + ' 的 heredoc 头')
    const bodyStart = text.indexOf('\n', start) + 1
    const end = text.indexOf('\n' + d + '\n', bodyStart)
    if (end < 0) throw new Error('生成物里找不到 ' + name + ' 的 heredoc 尾')
    out[name] = text.slice(bodyStart, end)
  }
  return out
}

function readParts() {
  const files = {}
  for (const name of PARTS) files[name] = readFileSync(join(HERE, name), 'utf8')
  return files
}

/** 校验生成物：内容逐字节对得上、指纹对得上 */
export function checkInstaller(text, files) {
  const got = extractParts(text)
  for (const name of PARTS) {
    if (got[name] !== files[name].replace(/\n$/, '')) throw new Error('生成物里的 ' + name + ' 与源文件不一致')
  }
  if (!text.includes('源文件指纹：' + fingerprint(files))) throw new Error('生成物的指纹与源文件不一致')
  // 包装部分（头部注释、临时目录、收尾）也必须一致，否则重新打包会静默改行为
  if (text !== buildInstaller(files)) throw new Error('生成物与 buildInstaller() 的输出不一致（包装部分被改过？重新打包）')
  return true
}

// 直接执行时：生成（或 --check 校验）
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = readParts()
  const check = process.argv.includes('--check')
  if (check) {
    const text = readFileSync(OUT, 'utf8')
    checkInstaller(text, files)
    console.log('OK ' + OUT + ' 与源文件一致（指纹 ' + fingerprint(files) + '）')
  } else {
    const text = buildInstaller(files)
    checkInstaller(text, files)
    writeFileSync(OUT, text, 'utf8')
    console.log('已生成 ' + OUT + '（' + Buffer.byteLength(text) + ' B，指纹 ' + fingerprint(files) + '）')
  }
}
