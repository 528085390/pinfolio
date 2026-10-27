import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DATA_DIR, ROOT } from '../db.js'
import { renderSnapshot } from './markdown.js'
import { loadAssets, loadFields, loadLastChange, loadNotes, loadTags } from './rows.js'
import { resolveSnapshotTarget } from './target.js'

/**
 * SNAPSHOT.md 的取数 + 写文件 + 防抖。
 * 只读数据库、只写一个文件；任何失败都只打日志，不影响请求。
 */

/**
 * 落盘目标，import 时求值一次（ROOT/DATA_DIR 本身就是模块级单例，改不了也重算不了）：
 * - 设了 PINBOARD_SNAPSHOT 就写那里（桌面端把快照放到用户目录，项目根那份不碰）
 * - 否则正式实例写 <root>/SNAPSHOT.md
 * - 隔离实例返回 null = 不写快照
 * 所以这两个环境变量都必须在 import 之前设好（见 server/db.ts 的 DATA_DIR）。
 */
const SNAPSHOT_TARGET = resolveSnapshotTarget({
  snapshotEnv: process.env.PINBOARD_SNAPSHOT,
  root: ROOT,
  dataDir: DATA_DIR,
})

/**
 * 隔离实例（PINBOARD_DATA 指到别处，比如邮件 e2e 的 tests/e2e-data）**不许写快照**：
 * 它拿的是空库，会生成一份 1 KB 的 SNAPSHOT.md 把真库那份覆盖掉（2026-10-21 踩过）。
 * 正式实例（tools\pinboard.ps1 / start.cmd）不设这个变量，所以判断方式就是「数据目录是不是默认那个」。
 * 判定本身在 ./target.ts 的 resolveSnapshotTarget（纯函数、有单测），这里只用它的结果。
 */

/** 快照路径：不写快照时它只是个名义值（pnpm snapshot 与既有 import 都还用得到这个名字） */
export const SNAPSHOT_PATH = SNAPSHOT_TARGET ?? join(ROOT, 'SNAPSHOT.md')

/** 查库 + 渲染，得到整份快照文本（不写文件） */
export function buildSnapshot(): string {
  return renderSnapshot({
    assets: loadAssets(),
    notes: loadNotes(),
    tags: loadTags(),
    fields: loadFields(),
    lastChange: loadLastChange(),
  })
}

/** 立即重写快照；失败只打日志 */
export async function writeSnapshot(): Promise<string | null> {
  if (SNAPSHOT_TARGET === null) {
    console.warn('[snapshot] 隔离实例（PINBOARD_DATA）不写 SNAPSHOT.md')
    return null
  }
  try {
    const text = buildSnapshot()
    // 父目录可能还不存在（桌面端首启把快照指向用户目录时就是这种），先建出来再写；
    // 正式实例的目录本来就存在，mkdir recursive 是空转，行为不变。
    await mkdir(dirname(SNAPSHOT_TARGET), { recursive: true })
    await writeFile(SNAPSHOT_TARGET, text, 'utf8')
    return SNAPSHOT_TARGET
  } catch (err) {
    console.warn('[snapshot] 生成失败：', err instanceof Error ? err.message : err)
    return null
  }
}

let timer: NodeJS.Timeout | null = null
let running = false
let dirty = false

/** 请求改动后调用：1.5 秒防抖，合并连续写入 */
export function scheduleSnapshot(delay = 1500): void {
  if (SNAPSHOT_TARGET === null) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void flush()
  }, delay)
  if (timer.unref) timer.unref()
}

/** 关服务时用：取消还没触发的防抖计时器（已经在写的那次不受影响） */
export function cancelSnapshot(): void {
  if (timer) clearTimeout(timer)
  timer = null
}

async function flush(): Promise<void> {
  if (running) {
    dirty = true
    return
  }
  running = true
  try {
    await writeSnapshot()
  } finally {
    running = false
    if (dirty) {
      dirty = false
      scheduleSnapshot(200)
    }
  }
}
