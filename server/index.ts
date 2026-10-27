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
  console.log('[pinboard] ' + t('密码已重置，请访问 Web 界面重新设置'))
  process.exit(0)
}

// --new-token <name>：发一个永不过期的 API token（明文只打印一次）
const tokenIdx = process.argv.indexOf('--new-token')
if (tokenIdx !== -1) {
  const name = process.argv[tokenIdx + 1]
  if (!name) {
    console.error(t('用法: --new-token <名称>'))
    process.exit(1)
  }
  const { token } = createApiToken(db, name)
  console.log(`[pinboard] ${t('API Token「{name}」已生成（请妥善保存，仅显示一次）:', { name })}`)
  console.log(token)
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

console.log(`[pinboard] ${t('服务已启动')}: ${handle.url}`)

// 优雅退出：停掉 IMAP 连接池
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await shutdownMail()
    await handle.close().catch(() => {})
    process.exit(0)
  })
}
