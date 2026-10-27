// 「根目录那几份配置文件」到底在哪：桌面端打包后 process.cwd() 是安装目录 / System32 一类，
// 那 4 份文件其实躺在数据目录里，所以**数据目录优先、cwd 兜底**。
// 纯函数：只碰 node:fs / node:path，不读 process.env、不 import server/db.js，这样能单测（同 tags.ts 的做法）。
import { statSync } from 'node:fs'
import { join } from 'node:path'

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * 按 names 的顺序解析出实际存在的配置文件绝对路径（缺失的跳过；同名两份都在时数据目录那份胜出，只返回一条）。
 * @param names 裸文件名列表，例如 `quick-links.json`
 * @param input dataDir 数据目录、cwd 兜底目录（由调用方显式传入，函数内部不猜）
 */
export function resolveConfigPaths(names: string[], input: { dataDir: string; cwd: string }): string[] {
  const { dataDir, cwd } = input
  const found: string[] = []
  for (const name of names) {
    const inData = join(dataDir, name)
    if (isFile(inData)) {
      found.push(inData)
      continue
    }
    const inCwd = join(cwd, name)
    if (isFile(inCwd)) found.push(inCwd)
  }
  return found
}
