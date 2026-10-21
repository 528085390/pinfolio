# pinboard 测试

这些脚本原本散在 `tmp/`，2026-10-21 整理时搬到这里。测试**不改断言**，跑法也没变，只是位置固定下来、加了统一入口。

## 快速开始

```powershell
cd D:\pinfolio

pnpm test          # typecheck + 摘要清洗单测（不需要服务）
pnpm test:e2e      # core + monitor 全套（需要服务已在跑）
pnpm test:mail     # 邮件套件（必须先按下面起隔离实例）
```

`pnpm test:e2e` 默认跑 `core` + `monitor`，串行执行并汇总。单独跑某一组：

```powershell
node tests/run.mjs --only=core
node tests/run.mjs --only=monitor
node tests/run.mjs --only=mail
```

## 前置条件

| 套件 | 需要什么 |
|---|---|
| `core`（smoke / e2e / done / filter / archive / tagbar / router / tagpop） | pinboard 在 `http://127.0.0.1:7788` 运行；测试会自己建/删临时便签与标签 |
| `monitor`（monitor-note / monitor-drawer / alert） | 同上；`monitor-drawer` 还需要 Kuma 在 `http://127.0.0.1:3001`，会临时建观测项并在结束时清理 |
| `mail`（e2e-mail / mail-api-smoke） | 隔离实例 + `tests/fakeimap` 的依赖（见下） |

`core` 与 `monitor` 里的地址是硬编码的 `127.0.0.1:7788`；只有 `mail` 与 `alert` 认环境变量。

## 邮件套件（隔离实例）

库里有真实 Gmail 账号时**必须**用隔离实例，否则测试会清账号 / 断言失败：

```powershell
# 1. 起一个隔离实例（数据目录和端口都和正式实例分开）
$env:PINBOARD_DATA='D:\pinfolio\tests\e2e-data'
$env:PORT='7799'
pnpm start

# 2. 另一个窗口跑测试
cd D:\pinfolio
$env:MAIL_E2E_BASE='http://127.0.0.1:7799'
pnpm test:mail

# 3. 跑完停掉隔离实例，删掉 tests\e2e-data
```

`tests/fakeimap/` 有自己的一份 `package.json`（hoodiecrow-imap + imapflow + mailparser），不是项目依赖。清过 `tmp/` 或换机器后先：

```powershell
cd tests\fakeimap
npm install
```

## 说明

- 测试里的截图仍写到 `tmp/`（`tmp/shot-*.png` 已在 `.gitignore` 里），不影响版本库。
- 当年摸 hoodiecrow 能力的一次性探针（`tests/fakeimap/probe*.mjs`：文件夹形状、APPEND、批量信）已在 2026-10-21 工程整理时删除；要复现这类实验，照 `tests/e2e-mail.mjs` 里 `startFakeImap` + `ImapFlow` 的写法重写。
- 跑观测抽屉测试前确认 Kuma 在跑；中途失败可能留下临时观测项，必要时用 `kuma\tools\kuma-monitor.cjs del <id>` 清掉。
