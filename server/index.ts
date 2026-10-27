import { startServer } from './app.js'
import { DATA_DIR, db } from './db.js'
import { createApiToken, deleteSetting } from './auth/store.js'
import { runBackup } from './backup/run.js'
import { shutdownMail } from './mail/routes.js'
import { t } from './i18n.js'

// 入口只剩 CLI 分支、信号处理与启动日志；服务组装（壳 + /api + 定时器 + 监听）在 server/app.ts 的 startServer()。
// web / Docker 走的就是这一条：默认 127.0.0.1:7788，HOST / PORT 可覆盖。

// --reset-password：删掉密码后退出，下次访问回到 /setup
if (process.argv.includes('--reset-password')) {
  deleteSetting(db, 'password_hash')
  console.log('  已清除登录密码，重启后访问 /setup 重新设置')
  process.exit(0)
}

// --new-token <名字>：给脚本 / e2e 发一个 API token，明文只打印这一次
if (process.argv.includes('--new-token')) {
  const i = process.argv.indexOf('--new-token')
  const token = createApiToken(db, process.argv[i + 1] || 'cli')
  console.log(token.token)
  process.exit(0)
}

// --backup：立刻跑一次备份（两个目的地按配置来），适合放进 cron / 任务计划
if (process.argv.includes('--backup')) {
  const only = process.argv.includes('--local') ? 'local' : process.argv.includes('--remote') ? 'remote' : undefined
  const report = await runBackup(db, { only })
  for (const [dest, r] of Object.entries(report)) {
    console.log('  ' + (dest === 'local' ? t('本机文件') : t('远端数据库')) + '  ->  ' + (r.ok ? t('成功：') + (r.detail || '') : t('失败：') + (r.error || '')))
  }
  if (!Object.keys(report).length) console.log('  没有可用的备份目的地（本机已关且未配置远端库）')
  process.exit(0)
}

const handle = await startServer()

console.log('')
console.log('  pinfolio 已启动  ->  ' + handle.url)
console.log('  数据目录      ->  ' + DATA_DIR)
console.log('')

// 退出时断开 IMAP 连接（IMAP 是长连接，进程被 Ctrl+C / SIGTERM 时礼貌收尾）
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    try { shutdownMail() } catch { /* ignore */ }
    process.exit(0)
  })
}
