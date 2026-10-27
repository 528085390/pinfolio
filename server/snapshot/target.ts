import { join, resolve } from 'node:path'

/**
 * 决定 SNAPSHOT.md 写到哪：**纯函数**，入参全给进来（不 import db.js，不读 process.env）。
 *
 * 为什么单独拆一个文件：`write.ts` 一 import 就拉着 db.js 开 SQLite，没法单测；
 * 而「隔离实例不写快照」这条护栏是踩过坑的（2026-10-21 空库把真库的快照盖了），得能锁住。
 *
 * 返回：
 * - 路径字符串 = 写到那里
 * - `null` = 不写快照
 *
 * 优先级：`PINBOARD_SNAPSHOT` 显式指定 > 隔离判定。显式指定时即便数据目录是隔离的也照写
 * （桌面端就是这么用的：数据目录和快照都放到用户目录，替掉项目根那份）。
 */
export function resolveSnapshotTarget(input: {
  /** `process.env.PINBOARD_SNAPSHOT`；空串/纯空白按「没设置」处理（docker-compose 里常见 `VAR=`） */
  snapshotEnv: string | undefined
  /** 项目根（server/db.js 的 ROOT） */
  root: string
  /** 数据目录（server/db.js 的 DATA_DIR） */
  dataDir: string
}): string | null {
  const explicit = input.snapshotEnv?.trim()
  if (explicit) return explicit
  // 数据目录不是 <root>/data 就是隔离实例（邮件 e2e、桌面端那种），不写快照
  if (normalizeForCompare(input.dataDir) !== normalizeForCompare(join(input.root, 'data'))) return null
  return join(input.root, 'SNAPSHOT.md')
}

/**
 * 比较两个目录用：resolve 归一（去掉尾部 /、折叠 . 与 ..），Windows 再折大小写。
 * 只用于判断，不用来拼落盘路径——返回给调用方的还是原样的 join。
 */
function normalizeForCompare(p: string): string {
  const abs = resolve(p)
  return process.platform === 'win32' ? abs.toLowerCase() : abs
}
