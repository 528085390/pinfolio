// 铁律 6：写接口的日志不得打印请求体 / 密码（Task 7 评审 I-2）
//
// 为什么是静态断言（不是起服务扫日志）：POST /api/outbound 的请求体里有明文密码，
// 要靠「跑一遍再看日志里有没有」来证明，等于把泄漏本身当成检测手段，而且依赖跑不跑得到那条分支。
// 这里直接读 server/routes/outbound.ts 的源码做结构断言 —— 仿 kuma 工作树 818b548 的做法
// （「加固无凭据日志护栏（fail-closed/allowlist）」），思路三条：
//
//   1. **提取器不能空转**：先把每个 console.* 调用的实参按括号配平抠出来，再用三种口径交叉核对
//      （调用数 / 标识符数 / 抠出的实参条数），任何「别名绕过、解析出 0 条、只数到一半」都当场变红；
//   2. **黑名单**：实参（以及每一个含 console.* 的行）不许出现 body / JSON.stringify / password / proxy；
//   3. **白名单（fail-closed）**：实参必须逐条出现在 ALLOWED_LOGS 里 —— 也就是**新增任何一条日志，
//      都必须先来这里显式放行**，否则测试红。宁可多改一行测试，也不让「顺手多打点日志」混进去。
//
// 已知边界（照实写）：这是**文本形状**级断言，不是「任何重新引入都抓得到」的证明 ——
// 比如先把请求体赋给一个不叫 body 的变量、或者从别的模块拿回一个已串化好的字符串，
// 形状上就看不见了。它挡的是「在路由里直接打请求体 / 密码」这条最省事的错路，够用的地方在这。
//
// 运行：node --import tsx --test tests/unit/*.test.mts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TARGET = 'server/routes/outbound.ts'
const src = readFileSync(join(ROOT, TARGET), 'utf8')

/**
 * 唯一的白名单：每条日志的实参（空白归一后）必须逐字等于其中一项。
 * 现在只有一条 —— 「切换后重探没启动」只打错误消息。加日志就加到这里，同时确认它不含请求体/凭据。
 */
const ALLOWED_LOGS: string[] = [
  "'[outbound] 切换后重探没启动：' + String(e?.message || e)",
]

/** 黑名单：日志实参 / 含日志的行里都不许出现的词 */
const FORBIDDEN: Array<[string, RegExp]> = [
  ['请求体 body', /\bbody\b/i],
  ['JSON.stringify（整包串化）', /\bJSON\s*\.\s*stringify\b/i],
  ['password / 密码字段', /password/i],
  ['proxy 对象整体', /\bproxy\b/i],
  ['payload（请求体在路由里的变量名）', /\bpayload\b/i],
  ['validated（校验后的请求体，可能带明文密码）', /\bvalidated\b/i],
  ['settings 整包（含代理与密码）', /\bsettings\b/i],
]

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * 去掉 // 与 /* *\/ 注释，注释换成空格（行号与标识符位置不变）。
 * 字符串 / 模板串原样保留 —— 日志文案就在里面，黑名单要查它。
 * 已知局限：不识别正则字面量里的 // 与模板串 \${} 里的字符串（本文件都没有，出现时这里会先红再改）。
 */
function stripComments(code: string): string {
  let out = ''
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    const next = code[i + 1]
    if (ch === '/' && next === '/') {
      while (i < code.length && code[i] !== '\n') {
        out += ' '
        i += 1
      }
      continue
    }
    if (ch === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2)
      const stop = end === -1 ? code.length : end + 2
      while (i < stop) {
        out += code[i] === '\n' ? '\n' : ' '
        i += 1
      }
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      out += ch
      i += 1
      while (i < code.length) {
        if (code[i] === '\\') {
          out += code[i] + (code[i + 1] ?? '')
          i += 2
          continue
        }
        out += code[i]
        if (code[i] === quote) {
          i += 1
          break
        }
        i += 1
      }
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/** 抠出每个 console.* 调用的实参文本（括号配平，允许跨行） */
function collectLogArgs(code: string): string[] {
  const out: string[] = []
  const re = /\bconsole\s*\.\s*[A-Za-z_$][\w$]*\s*\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    let i = re.lastIndex
    let depth = 1
    while (i < code.length && depth > 0) {
      const ch = code[i]
      if (ch === '(') depth += 1
      else if (ch === ')') depth -= 1
      i += 1
    }
    out.push(code.slice(re.lastIndex, i - 1))
  }
  return out
}

/**
 * 护栏本体：返回违规说明列表（空 = 通过）。
 * 抽成函数是为了下面能用「人工注入的坏样本」自证它不是永远返回空。
 */
function logGuardViolations(code: string): string[] {
  const bad: string[] = []
  const stripped = stripComments(code)
  const calls = collectLogArgs(stripped)
  const callCount = (stripped.match(/\bconsole\s*\.\s*[A-Za-z_$][\w$]*\s*\(/g) || []).length
  const identCount = (stripped.match(/\bconsole\b/g) || []).length

  // --- fail-closed 1：必须有日志被检查到（否则一个「解析不出任何东西」的提取器也能绿）---
  if (callCount === 0) bad.push('没找到任何 console.* 调用：提取器空转，这条护栏等于没有')

  // --- fail-closed 2：提取器不许漏调用点 ---
  if (calls.length !== callCount) bad.push('提取到 ' + calls.length + ' 条日志实参，源码里有 ' + callCount + ' 个 console.* 调用')

  // --- fail-closed 3：console 只许出现在「被调用」的位置；别名 / 解构 / 裸引用都绕得过提取器 ---
  if (identCount !== callCount) bad.push('console 标识符出现 ' + identCount + ' 次，但只有 ' + callCount + ' 处在调用（别名 / 解构 / 裸引用要禁止）')

  // --- 白名单：条数与内容都要对得上（新增日志必须显式放行）---
  const allowed = ALLOWED_LOGS.map(norm)
  if (calls.length !== allowed.length) bad.push('日志条数 ' + calls.length + ' 与白名单条数 ' + allowed.length + ' 不一致：新增或删除了日志却没更新 ALLOWED_LOGS')

  for (const raw of calls) {
    const arg = norm(raw)
    for (const [name, re] of FORBIDDEN) {
      if (re.test(arg)) bad.push('日志实参里出现了' + name + '：' + arg)
    }
    if (!allowed.includes(arg)) bad.push('日志实参不在白名单里（fail-closed）：' + arg)
  }

  // --- 逐行黑名单（用户口径：凡含 console.* 的行都不许出现这些词）---
  stripped.split('\n').forEach((line, idx) => {
    if (!/\bconsole\s*\./.test(line)) return
    for (const [name, re] of FORBIDDEN) {
      if (re.test(line)) bad.push('第 ' + (idx + 1) + ' 行的日志出现了' + name + '：' + line.trim())
    }
  })

  return bad
}

test('server/routes/outbound.ts 的日志不含请求体 / 密码（白名单之外一律红）', () => {
  assert.deepEqual(logGuardViolations(src), [])
})

test('护栏自证：注入打印请求体 / 密码的日志都会被抓红（护栏不能永远是绿的）', () => {
  const bad = [
    "console.warn(JSON.stringify(body))",
    "console.warn('[outbound] 收到请求体：' + JSON.stringify(body))",
    "console.warn('收到请求体', body)",
    "console.error(payload)",
    "console.log(validated)",
    "console.warn('password=' + payload.proxy.password)",
    "console.warn('proxy: ' + String(before.monitorOutboundProxy))",
    "console.warn('设置写完了：' + JSON.stringify(next))",
    // 跨行写法：单行黑名单看不到，靠实参级检查抓
    "console.warn(\n  JSON.stringify(body),\n)",
    // 别名绕过：提取器看不到 d(...)，靠 console 标识符计数抓
    "const d = console.warn\nd(JSON.stringify(body))",
  ]
  for (const snippet of bad) {
    assert.notDeepEqual(logGuardViolations(snippet), [], '这条注入必须被抓住：' + JSON.stringify(snippet))
  }

  // 对照：现在文件里那条合法日志单独拿出来必须放行（否则上面全是「因为提取不到所以红」）
  const okSnippet = "console.warn('[outbound] 切换后重探没启动：' + String(e?.message || e))"
  assert.deepEqual(logGuardViolations(okSnippet), [])
})

test('护栏自证：注释里的 console 字样不影响判定（不制造假红）', () => {
  // 说明文档里写一句 console.warn(JSON.stringify(body)) 不该把测试弄红 —— 那是注释，不是日志
  const withComment = [
    '// 反面教材：console.warn(JSON.stringify(body)) 这种写法会被下面的护栏抓',
    "console.warn('[outbound] 切换后重探没启动：' + String(e?.message || e))",
  ].join('\n')
  assert.deepEqual(logGuardViolations(withComment), [])
})
