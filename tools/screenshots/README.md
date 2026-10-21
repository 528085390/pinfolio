# 截图脚本

这里放的是拍图用的 Playwright 脚本，产物一律写 `tmp/shot-*.png`（`.gitignore` 已忽略）。**仓库里不放截图**（页面里是本机真实数据），要图自己拍。

**必须在项目根目录运行**（脚本里的输出路径是相对 cwd 的 `tmp/...`）：

```powershell
cd D:\pinfolio
node tools/screenshots/shots.mjs          # 便签 / 资产 / 抽屉 / 设置
node tools/screenshots/shots-assets.mjs   # 资产页卡片与表格
node tools/screenshots/shots-mail.mjs     # 邮件页 inbox / 深色 / 账号抽屉（见下方警告）
node tools/screenshots/shots-monitor-drawer.mjs
node tools/screenshots/shots-tagpop.mjs   # 标签弹层
node tools/screenshots/shot-alert.mjs     # 观测异常通知三种状态
powershell -File tools/screenshots/resize-shots.ps1   # 2x 截图缩成 1x
```

前提：pinboard 已在 7788 跑着、前端已 `pnpm build`。

浏览器路径由 `tools/chrome-path.mjs` 统一决定：先看环境变量 `CHROME_PATH`，没有就找 Playwright 自带的 chromium（`%LOCALAPPDATA%\ms-playwright\chromium-1217\...`），再退到系统 Chrome。**脚本里不要再写死家目录**——仓库是公开的，写死会同时泄漏路径和让别人的机器跑不起来。

**⚠️ `shots-mail.mjs` 会删掉目标实例上的所有邮箱账号**（再建一个指向假 IMAP 的），所以它默认指向 7799 而不是 7788，只许对着隔离实例跑：

```powershell
# 另开一个终端起隔离实例（数据目录在 tests\e2e-data，不碰正式库）
cd D:\pinfolio
cmd /c "set PINBOARD_DATA=D:\pinfolio\tests\e2e-data&& set PORT=7799&& npx tsx server/index.ts"
# 再跑截图
$env:SHOT_BASE='http://127.0.0.1:7799'; node tools/screenshots/shots-mail.mjs
# 跑完按端口杀进程再删目录（先杀进程，否则目录会被重建）
Get-NetTCPConnection -LocalPort 7799 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
Remove-Item -Recurse -Force tests\e2e-data
```

对着正式实例（7788）跑会把真实 Gmail 账号配置删掉。
