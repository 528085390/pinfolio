#!/usr/bin/env node
// i18n 巡检：找出还没包进 t('…') 的中文文案，以及「源码里有、字典里没有」的条目。
//
//   node tools/i18n-scan.mjs            # 列出待翻译的行（文件:行 + 片段）
//   node tools/i18n-scan.mjs --missing  # 列出字典缺失的中文字面量（去重）
//   node tools/i18n-scan.mjs --check    # 还有未包装的中文就 exit 1（提交前跑；下面 KNOWN_TODO 里的已知例外不算）
//   node tools/i18n-scan.mjs --files    # 只按文件汇总条数，按数量降序（排工期用）
//
// 判定规则（够用就好，不做完整 AST）：
//   · 字符串/模板字面量里出现 CJK，且紧邻前面不是 t( / tn(  → 待翻译
//   · 字符串之外出现 CJK（JSX 文本、属性外的裸文本）  → 待翻译
//   · 整行注释、块注释里的中文忽略
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/
const CJK_ONLY = /[\u3400-\u4dbf\u4e00-\u9fff]/
const SKIP_DIRS = new Set(['node_modules', 'dist', 'data', 'logs', 'tmp', 'docs', 'tests'])
// 这几个文件不参与翻译：
//  · i18n 自己的实现与中文原文（它们天生就是中文键）
//  · server/snapshot/markdown.ts 生成的是给人读的 SNAPSHOT.md（仓库文档，不随界面语言变）
const SKIP_FILES = new Set([
  'web/lib/i18n/index.ts',
  'server/i18n.ts',
  'shared/i18n/core.ts',
  'server/snapshot/markdown.ts',
])
const isDict = (rel) => rel.startsWith('shared/i18n/en/')

// 已知例外：这些中文是数据、协议常量或扫描器的误报，本来就不该翻（见 docs/i18n.md「已知边界」）。
// 按文件给上限而不是给行号：改了行号不影响，但往这些文件里加新的未包装中文会让计数超上限，--check 照样失败。
const KNOWN_TODO = new Map([
  ['server/kuma/provision.ts', { max: 3, why: '写进 Kuma 的观测项名字＝数据' }],
  ['server/kuma/recipe.ts', { max: 3, why: 'STEP_LABEL 常量值，消费处再 t()' }],
  ['server/metrics/onboard.ts', { max: 2, why: '正则里带引号，扫描器误报' }],
  ['web/lib/images.ts', { max: 2, why: '正则里带引号，扫描器误报' }],
  ['server/kuma/redact.ts', { max: 1, why: '正则里带引号，扫描器误报' }],
  ['web/pages/settings/TunnelCard.tsx', { max: 1, why: 'FRPC 模板，给用户复制的配置片段' }],
  ['server/kuma/beat.ts', { max: 1, why: '心跳状态前缀，协议常量' }],
])

const mode = process.argv.find((a) => a.startsWith('--')) || '--todo'
const checkMode = mode === '--check'

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue
      walk(p, out)
    } else if (/\.(ts|tsx|mts|js|mjs)$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

/** 扫一个文件，返回 { todo: [{line, snippet, kind}], literals: [string] } */
export function scanFile(text) {
  const todo = []
  const literals = []
  let line = 1
  let i = 0
  let quote = null // 当前所在字符串的引号
  let litStart = 0
  let litLine = 1
  let inBlock = false
  const n = text.length

  // 日志里的中文不翻（console.log/warn/error 是给运维看的中文），所以那些字面量不算待翻译。
  // 从字面量往前找**包住它的那个调用**的括号（跳过嵌套括号），再看被调用的是不是 console.*。
  const inConsoleCall = (at) => {
    let depth = 0
    for (let j = at - 1, steps = 0; j >= 0 && steps < 400; j--, steps++) {
      const ch = text[j]
      if (ch === ')') depth++
      else if (ch === '(') {
        if (depth > 0) { depth--; continue }
        return /console\s*\.\s*(?:log|warn|error|info|debug|trace)\s*$/.test(text.slice(Math.max(0, j - 60), j))
      } else if (ch === ';' || ch === '{' || ch === '}') return false
    }
    return false
  }

  const pushLiteral = (body, at, atLine) => {
    if (!CJK_ONLY.test(body)) return
    literals.push(body)
    if (inConsoleCall(at)) return
    // 往前跳过引号本身与空白，看是不是 t( / tn( 的括号。
    // 注意 at 是字符串正文第一个字符的下标，at-1 才是开引号，所以要退到 at-2。
    let j = at - 2
    while (j >= 0 && /[ \t\n]/.test(text[j])) j--
    const wrapped = j >= 0 && text[j] === '(' && /(?:^|[^\w$])t$/.test(text.slice(Math.max(0, j - 2), j))
    if (!wrapped) todo.push({ line: atLine, snippet: body.slice(0, 90), kind: 'string' })
  }

  while (i < n) {
    const c = text[i]
    if (inBlock) {
      if (c === '*' && text[i + 1] === '/') { inBlock = false; i += 2; continue }
      if (c === '\n') line++
      i++
      continue
    }
    if (quote) {
      if (c === '\\') { i += 2; continue }
      if (c === quote) {
        pushLiteral(text.slice(litStart, i), litStart, litLine)
        quote = null
        i++
        continue
      }
      if (c === '\n') line++
      i++
      continue
    }
    // 普通状态
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++
      continue
    }
    if (c === '/' && text[i + 1] === '*') { inBlock = true; i += 2; continue }
    if (c === "'" || c === '"' || c === '`') {
      quote = c; litStart = i + 1; litLine = line; i++; continue
    }
    if (CJK_ONLY.test(c)) {
      // JSX 文本或裸文本：取这一行剩下的部分做提示
      const end = text.indexOf('\n', i)
      const lineEnd = end === -1 ? n : end
      todo.push({ line, snippet: text.slice(i, Math.min(lineEnd, i + 90)).trim(), kind: 'text' })
      i = lineEnd
      continue
    }
    if (c === '\n') line++
    i++
  }
  return { todo, literals }
}

function collect() {
  const roots = ['web', 'server']
  const files = []
  for (const r of roots) {
    const abs = join(ROOT, r)
    try { walk(abs, files) } catch { /* 目录不存在 */ }
  }
  return files
    .map((f) => relative(ROOT, f).replace(/\\/g, '/'))
    .filter((rel) => !SKIP_FILES.has(rel) && !isDict(rel) && !/\.test\./.test(rel))
}

const dictKeys = (() => {
  const dir = join(ROOT, 'shared/i18n/en')
  const keys = new Map()
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.ts') || name === 'index.ts') continue
    const src = readFileSync(join(dir, name), 'utf8')
    for (const m of src.matchAll(/^\s*'((?:[^'\\]|\\.)*)'\s*:/gm)) {
      const k = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\')
      if (!keys.has(k)) keys.set(k, name)
    }
  }
  return keys
})()

if (mode === '--missing') {
  const seen = new Map()
  for (const rel of collect()) {
    const { literals } = scanFile(readFileSync(join(ROOT, rel), 'utf8'))
    for (const lit of literals) if (!dictKeys.has(lit) && !seen.has(lit)) seen.set(lit, rel)
  }
  for (const [lit, rel] of [...seen].sort()) console.log(rel + '\t' + JSON.stringify(lit))
  console.log('\n共 ' + seen.size + ' 条缺失 / 字典 ' + dictKeys.size + ' 条')
  process.exit(seen.size ? 1 : 0)
}

const rows = []
let total = 0
for (const rel of collect()) {
  const { todo } = scanFile(readFileSync(join(ROOT, rel), 'utf8'))
  if (!todo.length) continue
  rows.push({ rel, todo })
  total += todo.length
}
if (mode === '--files') {
  rows.sort((a, b) => b.todo.length - a.todo.length)
  for (const r of rows) console.log(String(r.todo.length).padStart(4) + '  ' + r.rel)
} else {
  for (const r of rows) for (const t of r.todo) console.log(r.rel + ':' + t.line + '\t' + t.snippet)
}
// 扣掉已知例外，剩下的才是真正待翻译的
let known = 0
let unknown = 0
for (const r of rows) {
  const allowed = Math.min(KNOWN_TODO.get(r.rel)?.max ?? 0, r.todo.length)
  known += allowed
  unknown += r.todo.length - allowed
}
const knownNote = known ? '，其中已知例外 ' + known + ' 处（数据 / 常量 / 误报）' : ''
console.log('\n待翻译 ' + total + ' 处 / ' + rows.length + ' 个文件' + knownNote + '；字典 ' + dictKeys.size + ' 条')
if (checkMode) process.exit(unknown ? 1 : 0)
