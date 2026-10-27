// 铁律 6（task-7 评审 I-2）与它的覆盖面（task-7-fix 复评 I-1）：出站相关的服务端模块，日志里不许沾
// 请求体 / 密码 / 整包设置。
//
// 为什么是静态断言（不是起服务扫日志）：POST /api/outbound 的请求体里有明文密码，靠「跑一遍再看日志里
// 有没有」来证明，等于把泄漏本身当成检测手段，而且依赖跑不跑得到那条分支。这里直接读源码做结构断言
// （仿 kuma 工作树 818b548 的 fail-closed 白名单）。
//
// ── 扫描面（覆盖规则，评审就照这三条核）────────────────────────────────────────────
//   1. GUARDED 里点名的三个文件必须在扫描面里；读不到就红（路径写错不会静默跳过）；
//   2. server/kuma/ 下**文件名以 outbound 开头**的 .ts 模块全部自动纳入 —— outbound.ts /
//      outbound-view.ts / outbound-recheck.ts，以及将来新增的 outbound-xxx.ts。新增同类模块**不用回来
//      改本文件**：它的任何一条新日志都会因为「不在 ALLOWED_LOGS 里」当场变红（fail-closed）；
//   3. 只有这两条。别的目录、别的命名要加进来必须显式写进 GUARDED —— 那是有意为之，不是漏。
//
// ── 什么算一次「日志调用」（比只管 console.* 宽，等价写法都要抓）──────────────────
//   - console.*（含 globalThis.console.*）
//   - process.stdout.write / process.stderr.write：**一律禁止**，不给白名单（真需要写就直接改本护栏，
//     让它成为一次显式的、被评审看见的改动）
//   - 括号取属性先归一化再判定：process['stdout'].write( 与 process.stdout['write']( 都归一成点号写法
//     （单 / 双 / 反引号三种引法都覆盖）
//   - 裸引用 / 别名 / 解构（const w = process.stdout.write、const { stdout } = process、const d = console.warn）
//     靠「标识符出现次数 == 调用次数」抓
//
// ── 三条 fail-closed ────────────────────────────────────────────────────────────
//   1. **提取器不能空转**：每个文件都要「调用数 / 标识符数 / 抠出的实参条数」三口径相等，且全扫描面至少一条日志；
//   2. **黑名单**：实参（以及每个含日志调用的行）不许出现 body / JSON.stringify / password / proxy / settings…；
//   3. **白名单带文件 + 内容特征**：每条日志的实参（空白归一后）必须逐字命中 ALLOWED_LOGS 里**同一个文件**
//      的那一条；反过来，白名单里每一条都必须真被用到（删日志不删白名单也红）。新增任何一条日志，都必须
//      先来这里显式放行。
//
// 已知边界（照实写）：这是**文本形状**级断言 —— 先把请求体赋给一个不叫 body 的变量、或者从别的模块拿回
// 一个已串化好的字符串，形状上就看不见了。它挡的是「顺手多打一行日志」这条最省事的错路。
//
// 运行：node --import tsx --test tests/unit/*.test.mts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 显式点名的受保护文件（少一个就红；要扩面就加到这里） */
const GUARDED = [
  'server/routes/outbound.ts', // GET/POST /api/outbound：请求体（含明文密码）就在这里
  'server/kuma/outbound-view.ts', // maskProxy / viewOf：这里的 raw 是 getSettings 的原值，带明文密码
  'server/kuma/outbound-recheck.ts', // 重探：只许打 id 与错误消息
]

/** 覆盖规则②：server/kuma 下文件名以 outbound 开头的 .ts 模块自动纳入（见文件头） */
const AUTO_PREFIX_DIR = 'server/kuma'
const AUTO_PREFIX_RE = /^outbound.*\.ts$/

/**
 * 唯一的白名单：**文件 + 内容特征**两条一起对，光有条数不算数。
 * 加日志就加到这里，同时确认它不含请求体 / 凭据。
 */
const ALLOWED_LOGS: Array<{ file: string; arg: string }> = [
  {
    file: 'server/routes/outbound.ts',
    arg: "'[outbound] 切换后重探没启动：' + String(e?.message || e)",
  },
  {
    file: 'server/kuma/outbound-recheck.ts',
    arg: "'[outbound] 重探 #' + id + ' 失败：' + String(e?.message || e)",
  },
  {
    file: 'server/kuma/outbound-recheck.ts',
    arg: "'[outbound] 本轮重探 ' + kicked + '/' + ids.length + ' 条成功'",
  },
]

/** 黑名单：日志实参 / 含日志调用的行里都不许出现的词 */
const FORBIDDEN: Array<[string, RegExp]> = [
  ['请求体 body', /\bbody\b/i],
  ['JSON.stringify（整包串化）', /\bJSON\s*\.\s*stringify\b/i],
  ['password / 密码字段', /password/i],
  ['proxy 对象整体', /\bproxy\b/i],
  ['payload（请求体在路由里的变量名）', /\bpayload\b/i],
  ['validated（校验后的请求体，可能带明文密码）', /\bvalidated\b/i],
  ['settings 整包（含代理与密码）', /\bsettings\b/i],
]

/* ── 日志调用点的形状 ─────────────────────────────────────────────────────────── */

/** console.<method>( —— 调用头 */
const CONSOLE_HEAD = /\bconsole\s*\.\s*[A-Za-z_$][\w$]*\s*\(/
/** process.std(out|err).write( —— 调用头（归一化之后） */
const STD_HEAD = /\bprocess\s*\.\s*std(?:out|err)\s*\.\s*write\s*\(/
/** 任何 console 标识符（含别名 / 裸引用 / 解构） */
const CONSOLE_IDENT = /\bconsole\b/
/** 任何 process.std(out|err).write（含裸引用：const w = process.stdout.write） */
const STD_WRITE_REF = /\bprocess\s*\.\s*std(?:out|err)\s*\.\s*write\b/
/** 任何 process.std(out|err) 成员访问 */
const STD_ACCESS = /\bprocess\s*\.\s*std(?:out|err)\b/
/** 任何 stdout / stderr 标识符（兜 const { stdout } = process 这种解构） */
const STD_IDENT = /\bstd(?:out|err)\b/

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

const countOf = (code: string, re: RegExp) =>
  (code.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) || []).length

/**
 * 去掉 // 与块注释，注释换成空格（行号与标识符位置不变）。
 * 字符串 / 模板串原样保留 —— 日志文案就在里面，黑名单要查它。
 * 已知局限：不识别正则字面量里的双斜杠、也不识别模板串插值里的字符串（本文件都没有，出现时这里会先红再改）。
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
    // 96 = 反引号（模板串）：直接写字面量容易把本文件自己搞坏，用码点判
    if (ch === "'" || ch === '"' || ch.charCodeAt(0) === 96) {
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

/**
 * 把括号取属性的等价写法归一成点号写法，后面的正则只认一种形状：
 *   process['stdout'] / process["stderr"]           → process.stdout / process.stderr
 *   process.stdout['write']（单 / 双 / 反引号都行）→ process.stdout.write
 * 用 [ \t]* 而不是 \s*：跨行匹配会吃掉换行，逐行黑名单的行号就对不上了。
 */
function normaliseMemberAccess(code: string): string {
  return code
    .replace(/\bprocess[ \t]*\[[ \t]*(['"\x60])std(out|err)\1[ \t]*\]/g, 'process.std$2')
    .replace(/\bprocess[ \t]*\.[ \t]*std(out|err)[ \t]*\[[ \t]*(['"\x60])write\2[ \t]*\]/g, 'process.std$1.write')
}

/** 抠出 head 命中的每次调用的实参文本（括号配平，允许跨行） */
function collectArgs(code: string, head: RegExp): string[] {
  const out: string[] = []
  const re = new RegExp(head.source, 'g')
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
 * 单文件护栏：返回违规说明（空 = 通过）。
 * 抽成函数是为了下面能用「人工注入的坏样本」自证它不是永远返回空，也能证明白名单是**按文件**判的。
 */
export function inspectSource(code: string, file: string): { bad: string[]; calls: string[] } {
  const bad: string[] = []
  const stripped = normaliseMemberAccess(stripComments(code))

  const calls = collectArgs(stripped, CONSOLE_HEAD)
  const callCount = countOf(stripped, CONSOLE_HEAD)
  const identCount = countOf(stripped, CONSOLE_IDENT)

  const stdArgs = collectArgs(stripped, STD_HEAD)
  const stdWriteCount = countOf(stripped, STD_WRITE_REF)
  const stdAccessCount = countOf(stripped, STD_ACCESS)
  const stdIdentCount = countOf(stripped, STD_IDENT)

  // --- fail-closed 1：提取器不许漏调用点 ---
  if (calls.length !== callCount) bad.push('提取到 ' + calls.length + ' 条日志实参，源码里有 ' + callCount + ' 个 console.* 调用')
  if (stdArgs.length !== stdWriteCount) bad.push('提取到 ' + stdArgs.length + ' 条 stdout/stderr 实参，源码里有 ' + stdWriteCount + ' 处 process.std*.write')

  // --- fail-closed 2：console 只许出现在「被调用」的位置（挡别名 / 解构 / 裸引用）---
  if (identCount !== callCount) bad.push('console 标识符出现 ' + identCount + ' 次，但只有 ' + callCount + ' 处在调用（别名 / 解构 / 裸引用要禁止）')

  // --- fail-closed 3：stdout / stderr 只许以 process.std*.write( 的形式出现 ---
  if (stdAccessCount !== stdWriteCount) bad.push('process.stdout / process.stderr 出现 ' + stdAccessCount + ' 次，但只有 ' + stdWriteCount + ' 处在 .write(...) 调用')
  if (stdIdentCount !== stdAccessCount) bad.push('stdout / stderr 标识符出现 ' + stdIdentCount + ' 次，但只有 ' + stdAccessCount + ' 处是 process.std* 成员访问（解构 / 别名要禁止）')

  // --- 绝对禁令：直接写 stdout / stderr 一律红，没有白名单 ---
  for (const raw of stdArgs) bad.push('禁止直接写 process.stdout / process.stderr（要加就改本护栏）：' + norm(raw))

  // --- 白名单：**同一个文件**的实参必须逐字命中 ---
  const allowed = ALLOWED_LOGS.filter((e) => e.file === file).map((e) => norm(e.arg))
  for (const raw of calls) {
    const arg = norm(raw)
    for (const [name, re] of FORBIDDEN) {
      if (re.test(arg)) bad.push('日志实参里出现了' + name + '：' + arg)
    }
    if (!allowed.includes(arg)) bad.push('日志实参不在 ' + file + ' 的白名单里（fail-closed）：' + arg)
  }

  // --- 逐行黑名单：凡含日志调用的行都不许出现这些词 ---
  stripped.split('\n').forEach((line, idx) => {
    if (!CONSOLE_HEAD.test(line) && !STD_ACCESS.test(line)) return
    for (const [name, re] of FORBIDDEN) {
      if (re.test(line)) bad.push('第 ' + (idx + 1) + ' 行的日志出现了' + name + '：' + line.trim())
    }
  })

  return { bad, calls }
}

/**
 * 扫描面：GUARDED ∪ server/kuma/outbound*.ts（覆盖规则见文件头）。
 * 抽成函数而不是常量，是为了让「自动纳入」这件事本身也能被断言。
 */
function guardedFiles(): string[] {
  const autoDir = join(ROOT, AUTO_PREFIX_DIR)
  const auto = readdirSync(autoDir)
    .filter((f) => AUTO_PREFIX_RE.test(f))
    .map((f) => AUTO_PREFIX_DIR + '/' + f)
    .sort()
  return [...GUARDED, ...auto.filter((f) => !GUARDED.includes(f))]
}

/** 全扫描面：返回 { files, calls, bad }（bad 空 = 通过） */
function scanGuarded(): { files: string[]; calls: number; bad: string[] } {
  const files = guardedFiles()
  const bad: string[] = []
  const used = new Set<string>()
  let calls = 0

  for (const f of files) {
    const abs = join(ROOT, f)
    if (!existsSync(abs)) {
      bad.push(f + '：扫描面上的文件不存在（改名 / 移动了就回来改本文件的覆盖规则）')
      continue
    }
    const r = inspectSource(readFileSync(abs, 'utf8'), f)
    for (const msg of r.bad) bad.push(f + '：' + msg)
    for (const arg of r.calls) used.add(f + '\u0000' + norm(arg))
    calls += r.calls.length
  }

  // fail-closed：一条日志都抠不出来，说明提取器空转，这条护栏等于没有
  if (calls === 0) bad.push('整个扫描面没找到任何一条日志调用：提取器空转，护栏等于没有')

  // 白名单反过来也要对：指向没被扫的文件 / 没被用到的条目都算红（删日志就得删白名单）
  for (const e of ALLOWED_LOGS) {
    if (!files.includes(e.file)) bad.push('ALLOWED_LOGS 指向未被扫描的文件（不会真的放行任何东西）：' + e.file)
    if (!used.has(e.file + '\u0000' + norm(e.arg))) {
      bad.push('ALLOWED_LOGS 里这条没被任何日志用到（删了日志就该删白名单）：' + e.file + ' → ' + norm(e.arg))
    }
  }

  return { files, calls, bad }
}

test('扫描面：三个点名的文件 + server/kuma 下所有 outbound*.ts 都在里面（覆盖规则不能悄悄缩水）', () => {
  const files = guardedFiles()
  for (const f of GUARDED) assert.ok(files.includes(f), '扫描面缺 ' + f)
  // 自动纳入的两条必须被前缀规则捡到，而不是靠 GUARDED 点名 —— 否则那条规则其实没生效
  assert.ok(files.includes('server/kuma/outbound-view.ts'))
  assert.ok(files.includes('server/kuma/outbound-recheck.ts'))
  // 造一个新名字，规则必须捡得到（这就是「将来新增同类模块也被扫到」那一条）
  assert.equal(AUTO_PREFIX_RE.test('outbound-新增模块.ts'), true)
  assert.equal(AUTO_PREFIX_RE.test('outbound.ts'), true)
  assert.equal(AUTO_PREFIX_RE.test('feed.ts'), false)
})

test('出站模块的日志不含请求体 / 密码（白名单之外一律红）', () => {
  const r = scanGuarded()
  assert.deepEqual(r.bad, [])
  // 至少得真的扫到日志，否则上面那条空断言没有意义
  assert.ok(r.calls >= 3, '扫描到的日志只有 ' + r.calls + ' 条')
})

test('护栏自证：注入打印请求体 / 密码的日志都会被抓红（护栏不能永远是绿的）', () => {
  const ROUTE = 'server/routes/outbound.ts'
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
    // ---- I-1 点名的两类等价泄漏 ----
    // 写 stdout 而不是 console（复评 M4，原来全绿）
    "process.stdout.write(JSON.stringify(body))",
    "process.stderr.write('收到请求体：' + JSON.stringify(body))",
    // 括号取属性的等价写法（原来连整串 indexOf 都找不到）
    "process.stdout['write'](JSON.stringify(body))",
    'process["stdout"].write(JSON.stringify(body))',
    "process['stdout']['write'](JSON.stringify(body))",
    // 不是打请求体也要红：本护栏的口径是「写 stdout/stderr 必须是被评审看见的改动」
    "process.stdout.write('ok')",
    // 裸引用 / 解构：没有 ( 也跟着红
    "const w = process.stdout.write\nw(JSON.stringify(body))",
    "const { stdout } = process\nstdout.write(JSON.stringify(body))",
  ]
  for (const snippet of bad) {
    assert.notDeepEqual(inspectSource(snippet, ROUTE).bad, [], '这条注入必须被抓住：' + JSON.stringify(snippet))
  }

  // 对照：现在文件里那条合法日志单独拿出来必须放行（否则上面全是「因为提取不到所以红」）
  const okSnippet = "console.warn('[outbound] 切换后重探没启动：' + String(e?.message || e))"
  assert.deepEqual(inspectSource(okSnippet, ROUTE).bad, [])
})

test('护栏自证：白名单按「文件 + 内容」判 —— 合法日志换个文件就必须红', () => {
  const okSnippet = "console.warn('[outbound] 切换后重探没启动：' + String(e?.message || e))"
  // 白名单里没有 outbound-view.ts 的条目：把路由那条日志搬到掩码模块也必须红（那里能拿到明文密码）
  assert.notDeepEqual(inspectSource(okSnippet, 'server/kuma/outbound-view.ts').bad, [])
  // 掩码模块里打原始 settings（复评 M8）—— 既不在白名单，也命中 settings 黑名单
  const m8 = 'function maskProxy(raw) {\n  console.log(settings)\n  return raw\n}'
  assert.notDeepEqual(inspectSource(m8, 'server/kuma/outbound-view.ts').bad, [])
  assert.notDeepEqual(inspectSource('console.log(raw)', 'server/kuma/outbound-view.ts').bad, [])
})

test('护栏自证：注释里的 console 字样不影响判定（不制造假红）', () => {
  // 说明文档里写一句 console.warn(JSON.stringify(body)) 不该把测试弄红 —— 那是注释，不是日志
  const withComment = [
    '// 反面教材：console.warn(JSON.stringify(body)) 这种写法会被下面的护栏抓',
    "console.warn('[outbound] 切换后重探没启动：' + String(e?.message || e))",
  ].join('\n')
  assert.deepEqual(inspectSource(withComment, 'server/routes/outbound.ts').bad, [])
})
