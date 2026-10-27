import { app, dialog } from 'electron'
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { desktopPaths } from './paths.js'

/**
 * 主进程日志（Task 7）。
 *
 * 桌面端没有控制台可看（打包后双击启动，stdout 直接消失），所以「出什么事了」只能靠文件：
 * - `log()` 追加写 <userData>/logs/main.log，同时回显到 stdout（开发态 / Task 10 的冒烟脚本
 *   就是按 stdout 里 `[pinfolio] listening on <url>` 那行解析端口的，格式别改）；
 * - 文件超 1 MB 就整体改名成 `main.log.1`（旧的直接覆盖，只留一代，不做无限归档）；
 * - `installCrashHandlers()` 接住 uncaughtException / unhandledRejection，写日志 + 弹错误框。
 *
 * 三条硬约定：
 * 1. **log() 永远不抛**：它经常被用来记录「正因为它而失败」的那些错误，自己再炸就等于
 *    把原始错误吞了（只读盘 / 磁盘满 / 权限不足都只降级到 stderr）。
 * 2. 路径只从 `desktopPaths(...).logFile` 来，不在这里另拼一份（Task 6 的 paths.ts 是唯一来源）。
 * 3. 崩溃弹框只弹一次：uncaughtException 之后进程状态已经未定义，连着弹窗会把用户锁死在
 *    一堆模态框里（每次崩溃只写日志）。
 */

/** 单文件上限：超过就把当前文件整体挪到 main.log.1 */
const MAX_BYTES = 1024 * 1024

/** 缓存 logFile：userData 一启动就定了，不必每次拼路径 */
let cachedFile: string | null = null
/** 崩溃弹框只弹一次 */
let boxShown = false
/** 崩溃处理器只挂一次 */
let installed = false

/** 日志文件绝对路径（崩溃提示框里要显示给用户） */
export function logFilePath(): string {
  if (cachedFile === null) cachedFile = desktopPaths(app.getPath('userData')).logFile
  return cachedFile
}

/** 本地时间戳：`2026-10-27 21:10:00.123`（UTC 不好对照用户自己的墙钟） */
function stamp(d: Date): string {
  const p2 = (n: number): string => String(n).padStart(2, '0')
  const p3 = (n: number): string => String(n).padStart(3, '0')
  return (
    d.getFullYear() +
    '-' + p2(d.getMonth() + 1) +
    '-' + p2(d.getDate()) +
    ' ' + p2(d.getHours()) +
    ':' + p2(d.getMinutes()) +
    ':' + p2(d.getSeconds()) +
    '.' + p3(d.getMilliseconds())
  )
}

/** 把任意参数转成一行文本：字符串原样、Error 用 stack、对象试 JSON、其余 String() */
function format(part: unknown): string {
  if (typeof part === 'string') return part
  if (part instanceof Error) return part.stack ?? part.name + ': ' + part.message
  if (typeof part === 'object' && part !== null) {
    try {
      return JSON.stringify(part)
    } catch {
      // 循环引用 / BigInt 之类，退到 String()
      try {
        return String(part)
      } catch {
        return '[unloggable object]'
      }
    }
  }
  try {
    return String(part)
  } catch {
    return '[unloggable value]'
  }
}

/**
 * 超 1 MB 就轮转：main.log → main.log.1（覆盖旧的）。
 * **Windows 上 rename 不覆盖已存在的目标**（EPERM/EEXIST），所以先删目标再重命名。
 */
function rotateIfNeeded(file: string): void {
  let size: number
  try {
    size = statSync(file).size
  } catch {
    return // 文件还不存在（首次启动）：不用转
  }
  if (size <= MAX_BYTES) return

  const kept = file + '.1'
  try {
    try {
      renameSync(file, kept)
    } catch {
      rmSync(kept, { force: true })
      renameSync(file, kept)
    }
  } catch (err) {
    // 转不动就接着往原文件追加：日志丢不起，更不该因为轮转失败把应用弄崩
    try {
      process.stderr.write('[log] 轮转 ' + file + ' 失败：' + format(err) + '\n')
    } catch {
      /* 没有 stderr，认了 */
    }
  }
}

/** 追加一行日志（时间戳 + 参数）。**永不抛异常**，见文件头约定 1 */
export function log(...parts: unknown[]): void {
  const line = '[' + stamp(new Date()) + '] ' + parts.map(format).join(' ') + '\n'

  try {
    const file = logFilePath()
    mkdirSync(dirname(file), { recursive: true })
    rotateIfNeeded(file)
    appendFileSync(file, line, 'utf8')
  } catch (err) {
    // 写不了文件（只读盘 / 权限 / 磁盘满）只降级到 stderr，绝不让调用方崩
    try {
      process.stderr.write('[log] 写日志失败：' + format(err) + ' ' + line)
    } catch {
      /* 连 stderr 都没有就算了 */
    }
  }

  // 回显到 stdout：开发态能直接在终端看到，Task 10 的冒烟脚本也靠它解析端口。
  // 打包态（GUI 子系统）没有控制台，write 可能抛 EPIPE —— 所以必须包起来。
  try {
    process.stdout.write(line)
  } catch {
    /* 没有控制台，忽略 */
  }
}

/** 记崩溃 + 弹一次错误框（弹框同步阻塞，所以只弹第一次） */
function reportCrash(kind: string, err: unknown): void {
  let file = '<userData>/logs/main.log'
  try {
    file = logFilePath()
  } catch {
    /* app 还没初始化完也照样写日志，路径就用占位符 */
  }
  log('[crash] ' + kind, err)
  log('[crash] 日志文件：' + file)

  if (boxShown) return
  boxShown = true
  try {
    // showErrorBox 可以在 app ready 之前调用，弹框是同步阻塞的
    dialog.showErrorBox('pinfolio 出错了', '日志：' + file)
  } catch (dlgErr) {
    log('[crash] 弹错误框失败（无 GUI 会话？）', dlgErr)
  }
}

/**
 * 挂崩溃处理器。启动最早处调用一次：单实例锁、建库、起服务、开窗任何一步炸掉，
 * 都要在 logs/main.log 里留下栈，而不是让窗口默默消失。
 */
export function installCrashHandlers(): void {
  if (installed) return
  installed = true
  process.on('uncaughtException', (err: unknown) => reportCrash('uncaughtException', err))
  process.on('unhandledRejection', (reason: unknown) => reportCrash('unhandledRejection', reason))
}
