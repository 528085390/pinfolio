// 英文词典的总装。按页拆文件，**同名键后面的覆盖前面的**（所以页面文件放后面）。
// 缺条目时 translate() 直接回落到源码里的中文原文，不会报错——渐进式翻译就是这么跑的。
import type { Dict } from '../core'
import { common } from './common'
import { format } from './format'
import { shell } from './shell'
import { auth } from './auth'
import { notes } from './notes'
import { assets } from './assets'
import { monitors } from './monitors'
import { hosts } from './hosts'
import { services } from './services'
import { mail } from './mail'
import { backup } from './backup'
import { settings } from './settings'
import { serverMonitor } from './server-monitor'
import { serverCore } from './server-core'

export const en: Dict = {
  ...common,
  ...format,
  ...shell,
  ...auth,
  ...notes,
  ...assets,
  ...monitors,
  ...hosts,
  ...services,
  ...mail,
  ...backup,
  ...settings,
  ...serverMonitor,
  ...serverCore,
}
