# pinboard 测试

这些脚本原本散在 `tmp/`，2026-10-21 整理时搬到这里。测试**不改断言**，跑法也没变，只是位置固定下来、加了统一入口。

## 快速开始

```powershell
cd D:\pinfolio

pnpm test          # typecheck + 单测 + 摘要清洗单测（不需要服务）
pnpm test:unit     # 只跑单测（node:test，秒级）
pnpm test:e2e      # core + monitor 全套（需要服务已在跑）
pnpm test:mail     # 邮件套件（必须先按下面起隔离实例）
```

## 单测（`tests/unit/`，2026-10-21 新增）

`pnpm test:unit` 用 Node 自带的 `node:test` 跑 `tests/unit/*.test.mts`（经 tsx 转译，零新依赖，秒级）。
覆盖的是**纯函数**：标签解析与配色（`server/tags.ts`）、代理地址规范化（`server/mail/proxy.ts`）、
Kuma 脱敏/策略说人话（`server/kuma/redact.ts`）、四态心跳与时间串（`server/kuma/beat.ts`）、
到期天数（`server/dates.ts`）、前端 URL ↔ 页面（`web/lib/paths.ts`）、金额/日期/相对时间（`web/lib/format.ts`）、
邮件摘要解析（`server/mail/parse.ts`：quoted-printable / base64 / html 剥标签 / 占位符与零宽字符 / 240 字上限）、
观测项状态判定（`web/pages/monitors/status.ts`：四色前缀优先于状态码、`pct()` 的 99.95% 取整、类型名映射）、
资产页取值（`web/pages/assets/meta.ts`：标签栏排序规则、卡片中间几行的顺序与「自定义字段最多 2 个」）、
两个编辑抽屉的表单逻辑（`web/components/monitor-drawer/form.ts` 的「只发改动字段」与三处校验、
`web/components/asset-drawer/form.ts` 的标签解析与提交形状、`monitor-drawer/display.ts` 的状态点取色）。

这些函数原来埋在 `db.ts` / `store.ts` / `client.ts` / `feed.ts` / `meta.ts` 里，那几个模块**一 import 就有副作用**
（打开 SQLite、连 socket、热状态页），单测碰不得，所以整理时把它们挪成独立纯模块，原模块再导出一次保持调用点不变。
新增纯逻辑优先放进对应纯模块，别塞回有副作用的文件里。

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
