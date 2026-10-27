import { join } from 'node:path'

// 桌面端要落盘的几个位置，全部以 Electron 的 app.getPath('userData') 为根推导出来。
// 这里是**纯函数**：只拼字符串，不 mkdir、不 import electron——主进程一 init 就要用，
// 而单测（node --test）里没有 Electron 运行时，必须能直接跑。

export type DesktopPaths = {
  /** 数据目录（SQLite 库、附件等都在这儿），对应服务端的 PINBOARD_DATA */
  dataDir: string
  /** SNAPSHOT.md：沿用服务端「快照写根目录」的口径，只是根换成 dataDir */
  snapshotPath: string
  /** 主进程日志。只有一个文件，不去转动归档 */
  logFile: string
  /** 窗口位置/尺寸的持久化文件（读写在 window-state.ts 里） */
  windowStateFile: string
}

export function desktopPaths(userDataDir: string): DesktopPaths {
  const dataDir = join(userDataDir, 'data')
  return {
    dataDir,
    snapshotPath: join(dataDir, 'SNAPSHOT.md'),
    logFile: join(userDataDir, 'logs', 'main.log'),
    windowStateFile: join(userDataDir, 'window-state.json'),
  }
}
