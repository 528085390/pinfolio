# 截图脚本

这里放的是给 README / `docs/screenshots/` 拍图用的 Playwright 脚本，产物一律写 `tmp/shot-*.png`（`.gitignore` 已忽略），挑好的再拷进 `docs/screenshots/`。

**必须在项目根目录运行**（脚本里的输出路径是相对 cwd 的 `tmp/...`）：

```powershell
cd D:\pinfolio
node tools/screenshots/shots.mjs          # 便签 / 资产 / 抽屉 / 设置
node tools/screenshots/shots-assets.mjs   # 资产页卡片与表格
node tools/screenshots/shots-mail.mjs     # 邮件页 inbox / 深色 / 账号抽屉
node tools/screenshots/shots-monitor-drawer.mjs
node tools/screenshots/shots-tagpop.mjs   # 标签弹层，顺带重拍 docs/screenshots/tag-picker.png
node tools/screenshots/shot-alert.mjs     # 观测异常通知三种状态
powershell -File tools/screenshots/resize-shots.ps1   # 2x 截图缩成 1x
```

前提：pinboard 已在 7788 跑着、前端已 `pnpm build`；浏览器用本机 ms-playwright 的 chromium（路径写在各脚本开头的 `exe` 常量里）。
