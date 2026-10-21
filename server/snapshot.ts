import { pathToFileURL } from 'node:url'
import { writeSnapshot } from './snapshot/write.js'

/**
 * SNAPSHOT.md 的入口与门面。
 * - 取数在 ./snapshot/rows.ts，渲染在 ./snapshot/markdown.ts（纯函数、有单测），写文件与防抖在 ./snapshot/write.ts
 * - 服务端只在写请求之后调 scheduleSnapshot()，别在别处直接写这个文件
 * - 本文件也当脚本用：pnpm snapshot（= tsx server/snapshot.ts）立即重生成一次
 */

export { SNAPSHOT_PATH, buildSnapshot, scheduleSnapshot, writeSnapshot } from './snapshot/write.js'
export { renderSnapshot } from './snapshot/markdown.js'
export type { AssetRow, FieldRow, NoteRow, TagRow } from './snapshot/rows.js'

// 直接执行时（pnpm snapshot / tsx server/snapshot.ts）立即生成一次
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (entry && import.meta.url === entry) {
  const p = await writeSnapshot()
  if (p) console.log('已生成 ' + p)
  else process.exitCode = 1
}
