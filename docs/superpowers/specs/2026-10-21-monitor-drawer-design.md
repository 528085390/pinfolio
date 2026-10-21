# 观测项详情抽屉（可编辑 / 暂停 / 删除 / 立即观测）设计

- 日期：2026-10-21
- 状态：待复核（用户已在对话里确认 4 个关键决策，均取推荐项）
- 涉及仓库：`D:\pinfolio`（主体）、`D:\kuma`（本地 fork，+1 个 socket 事件）
- 分类：architectural（pinboard 从「只读镜像」变成「可写控制器」，并引入可扩展的动作机制）

## 1. 背景与目标

观测页（`web/pages/MonitorsPage.tsx`）目前是纯只读看板：四格统计、筛选、搜索、卡片/表格、30 秒轮询。用户想点观测项卡片时从右侧弹出详情抽屉，「像资产详情那样」，在里面：

1. 自定义**名字、介绍、频率**等信息；
2. **暂停观测**、**删除观测**；
3. **立即观测**——这一项要可扩展：LLM 观测项的「立即观测」是立刻发一次新请求，每日打卡观测项的「立即观测」是直接跑一次一键出发。

成功的样子：不用开终端、不用记 CLI 参数，在页面上就能改名字/介绍/频率、暂停恢复、删掉不要的观测项；点「立即观测」能立刻看到这次的真实结果，而不是等下一个周期。

## 2. 非目标

- 不改 Kuma 的探测逻辑、不改 `policy_json` 求值器（策略只在抽屉里**只读展示**）。
- 不做观测项的**新建**（新建仍走 `kuma/tools/kuma-monitor.cjs add` + `ADD-MONITOR.md`）。
- 不做观测项历史曲线/图表（现有 40 拍色条够用）。
- 不把「立即观测」的动作配方做成抽屉里可编辑（v1 用 JSON 文件，见决策 4）。
- 不向上游 Uptime Kuma 提交任何 PR（`kuma/AGENTS.md` 的封号警告针对上游贡献；本设计只改本地 fork）。

## 3. 现状与约束（决定方案形状的事实）

| 事实 | 影响 |
|---|---|
| Kuma 没有 REST 写接口，改名/改频率/暂停/删除/立即检查全走 socket.io 事件 | pinboard 必须新建一条 socket 写通道 |
| `editMonitor`（`kuma/server/server.js:801-994`）是**全量覆盖**：拿前端传来的整个 monitor 对象逐字段覆盖 | 任何修改必须先 `getMonitor` 读全量、改目标字段、再整体回传；少传的字段会被清空 |
| `getMonitor` 返回的 bean 含 `sshPrivateKey` / `sshPassword` / `bearer_token` / `basic_auth_pass` 等 | 必须白名单裁剪后才允许出网到浏览器 |
| `monitor.start()` 结尾会**立刻跑一次真实探测**（`server/model/monitor.js:1291-1293`） | 轮询型观测项的「立即观测」= 重启检查循环，几乎是免费的 |
| push 型观测项 `start()` 只排下一次定时器，不立刻探 | #24 每日打卡的「立即观测」必须由外部触发推送 |
| Kuma 的 `/api/status-page/obs` 有 5 分钟缓存、缓存过期瞬间可能 5-30 秒才回（见 pinboard AGENTS.md 坑 #9） | 详情与「等结果」轮询**不能**走 status-page，要走 socket |
| `/api/status-page` 返回的 monitor 只有 `id/name/type/description/showMsg/sendUrl`，**没有 active** | 列表要显示「已暂停」需额外取一次 `getMonitorList` |
| `getMonitorBeats(id, period)` 直接查库、无缓存 | 详情页的「本次观测」和触发后等结果都用它 |
| `monitor-links.json` 现有 12 条按 `name` 匹配 | 改名会断跳转，必须改成按 `id` 匹配 |
| `policy_json` 里可能有按**名字**引用其他观测项的 gate | 改名会悄悄弄坏策略，改名时要做引用检查 |
| pinboard 无鉴权、只监听 127.0.0.1 | 写接口需要一层轻量 CSRF 防护（强制 JSON content-type） |

## 4. 需求

**FR-1** 点观测项卡片（网格视图）或表格行，从右侧弹出「观测项详情」抽屉；Esc / 点遮罩 / 关闭按钮收起。

**FR-2** 抽屉展示：状态点 + 名称、本次观测（状态/时间/耗时/消息）、最近 40 拍心跳色条、基础信息表单、策略只读行、立即观测区、底部动作条。

**FR-3** 可编辑并保存：名称、介绍、频率（interval）、超时、重试次数、重试间隔、是否在卡片显示本次消息（showMsg）。

**FR-4** 暂停 / 恢复观测（`active` 0/1），列表卡片对已暂停项显示「已暂停」标记。

**FR-5** 删除观测：抽屉内二次确认，必须手输观测项名称才能执行；删前自动备份 `kuma.db`。

**FR-6** 立即观测：按观测项的动作配方顺序执行，逐步骤回显结果（成功/失败、摘要、耗时）；同一观测项同时只允许一个动作在跑。

**FR-7** 保存 / 暂停 / 恢复 / 删除成功后，页面列表与 `kuma/SNAPSHOT.md` 在 2 秒内反映新状态。

**FR-8** 响应中不得出现任何敏感字段（私钥、口令、token）。

## 5. 关键决策（用户 2026-10-21 已确认，均取推荐项）

### 决策 1：名字 / 介绍 / 频率写回 Kuma（真改后端）

Kuma 保持唯一事实源，CLI 与 `SNAPSHOT.md` 看到的是同一份数据。配套两个保险：

- 改名时服务端扫一遍所有观测项的 `policy_json`，若有人按**旧名字**引用它，则拒绝改名并提示（策略 gate 里按名字引用会让改名静默失效）。
- 把 `monitor-links.json` 的 12 条规则从「按 name」改成「按 id」，以后随便改名都不影响跳转。

备选（未采用）：pinboard 本地覆盖层存别名——名字/介绍/频率分裂在两个系统，CLI 和 SNAPSHOT 永远是旧名，长期混乱。

### 决策 2：立即观测 = 配方 + 步骤执行器注册表

每个观测项的「立即观测」是一串有序步骤，配置在 `D:\pinfolio\monitor-actions.json`（热读，改完不用重启，与 `monitor-links.json` 同一套路）。步骤能力由代码里的注册表提供，v1 三种：

| 步骤类型 | 行为 | 典型用途 |
|---|---|---|
| `kuma-check` | 调 Kuma `checkNow` 事件重启检查循环 → 立刻真探一次 | 所有轮询型（HTTP / SSH / TCP / ping / dns / keyword） |
| `http` | 发一个 HTTP 请求（method/url/headers/body/timeout），解析 JSON 里的 `message` | 打卡面板 `POST /api/trigger-all`、以后任何「一键触发」型 |
| `command` | 跑一条本地命令（argv 数组，不经 shell 拼接） | 触发后立刻刷新 Kuma 心跳（`streak-beat.ps1 -Force`） |

**默认行为**：

- 非 push 型且没配配方 → 默认 `[{"type":"kuma-check"}]`，18 个已有观测项开箱即用；
- push 型且没配配方 → 「立即观测」按钮置灰，提示「push 型观测项只能由推送端触发，请在 monitor-actions.json 里给它配置动作」。

**执行语义**：顺序执行，任一步失败即中止；整体上限 60 秒；每个步骤独立超时；结果逐步骤回显。

### 决策 3：删除 = 真删 + 手输名字确认 + 删前备份

走 `deleteMonitor`（级联清 heartbeat 与 monitor_group 关系）。抽屉里点「删除」后整块切成确认面板，必须手输观测项名称才能点红色按钮；执行前把 `kuma/data/kuma.db` 复制到 `kuma/backups/kuma-YYYYMMDD-HHMMSS.db`（保留最近 5 份）。不提供「只停用不删」的独立按钮——停用由「暂停」覆盖。

### 决策 4：动作配方 v1 放 JSON 文件

跟 `monitor-links.json` 一致：热读、可进 git、加新观测项只改 JSON 不动代码。抽屉里只读展示「配方来源（config / default / none）」和步骤列表。UI 编辑留作后续需求。

## 6. 架构

```
浏览器 (React)
  MonitorsPage ── onClick ──▶ MonitorDrawer
       │                          │  GET/PATCH/DELETE/POST /api/monitors/:id/*
       ▼                          ▼
pinboard server (Hono)
  routes/monitors.ts  ── 聚合只读缓存（status-page，5min）
       │                ── 新增 6 个写/详情路由
       ├──▶ kuma.ts（新）        socket.io 客户端：登录 / 调用事件 / 超时 / 重连
       └──▶ monitor-actions.ts（新）  配方读取 + 步骤执行器注册表
                                          │
                                          ├──▶ kuma.ts（kuma-check）
                                          ├──▶ fetch（http）
                                          └──▶ child_process.spawn（command，argv 数组）
       ▼
Kuma 2.5.6 本地 fork (3001)
  server.js: getMonitor / editMonitor / pauseMonitor / resumeMonitor /
             deleteMonitor / getMonitorList / getMonitorBeats
             + 新增 checkNow（约 14 行）
```

### 6.1 pinboard 新增模块

**`server/kuma.ts`** —— Kuma 的 socket 写通道，唯一的出站连接点。

- 懒连接：首次调用时 `io(KUMA_URL)` + `login`；成功后复用同一 socket，事件调用并发安全。
- 调用封装 `call(event, ...args): Promise<any>`，20 秒超时；`ok:false` 转成 `KumaError(message)`。
- 断线（`disconnect` / `connect_error`）时丢弃连接，下次调用自动重连；连续 3 次失败抛「Kuma 没响应，先 `kuma.ps1 restart`」。
- 只暴露语义化函数：`getMonitor` / `getMonitorList` / `getMonitorBeats` / `editMonitor` / `pause` / `resume` / `remove` / `checkNow`。
- 凭据复用 `KUMA_USER` / `KUMA_PASS` / `KUMA_URL` 环境变量，默认值与 `kuma-monitor.cjs` 相同。

**`server/monitor-actions.ts`** —— 配方与步骤执行器。

- `loadActions()`：读 `monitor-actions.json`（`process.env.MONITOR_ACTIONS` 可覆盖路径），按 mtime 热读，解析失败只记日志并回退空数组。
- `resolveAction(monitor)`：先按 `id` 精确匹配，再按 `name` 全等匹配；无配置时按类型给默认或禁用。
- `runAction(monitor, onStep?)`：顺序执行，返回 `{ ok, steps: [{ type, label, ok, ms, summary, error? }] }`；整体 60 秒上限。
- 执行器注册表 `STEPS: Record<StepType, (step, ctx) => Promise<{ summary }>>`，新增步骤能力 = 加一个函数 + 一个类型。
- `command` 步骤的白名单：`ALLOWED_CMD_ROOTS = ['D:\\ai_project\\', 'E:\\bqj\\']`，可执行文件必须在白名单内，否则该步直接失败并说明原因。
- 并发锁 `Map<monitorId, Promise>`：重复触发返回 409。

### 6.2 Kuma fork 改动（`server/server.js`）

在 `resumeMonitor` 附近新增一个事件（`kuma/tools/kuma-monitor.cjs` 同步加 `check` 子命令，便于手工验证）：

```js
// 立即检查：重启检查循环 → monitor.start() 结尾会立刻跑一次真实探测
socket.on("checkNow", async (monitorID, callback) => {
    try {
        checkLogin(socket);
        const bean = await R.findOne("monitor", " id = ? AND user_id = ? ", [monitorID, socket.userID]);
        if (!bean) throw new Error("Monitor not found.");
        if (!(await Monitor.isActive(monitorID, bean.active))) {
            throw new Error("观测项已暂停，先恢复再立即观测。");
        }
        await restartMonitor(socket.userID, monitorID);
        callback({ ok: true, msg: "successCheckNow" });
    } catch (e) {
        callback({ ok: false, msg: e.message });
    }
});
```

改完需 `D:\kuma\tools\kuma.ps1 restart` 才生效（socket 事件在启动时注册）。

## 7. 数据模型

### 7.1 `monitor-actions.json`

```json
[
  {
    "id": 24,
    "label": "立即观测",
    "steps": [
      { "type": "http", "method": "POST", "url": "http://127.0.0.1:8765/api/trigger-all",
        "timeoutMs": 8000, "label": "触发一键出发",
        "hint": "每日打卡面板没启动？去 D:\\ai_project\\streak-panel 双击「启动项目.bat」" },
      { "type": "command", "label": "刷新 Kuma 心跳",
        "argv": ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                 "D:/ai_project/streak-panel/observability/streak-beat.ps1", "-Force"],
        "timeoutMs": 30000 }
    ]
  }
]
```

字段约束：`id` 或 `name` 至少一个；`steps` 非空数组；`http` 必须 `method` + `url`；`command` 必须 `argv` 数组（第一个元素是可执行文件）；`timeoutMs` 1000-55000；`label` 用于 UI 展示，缺省用步骤类型名。

### 7.2 详情接口的白名单字段

允许出网到浏览器：`id`、`name`、`type`、`description`、`showMsg`、`interval`、`timeout`、`maxretries`、`retryInterval`、`active`、`target`（脱敏后的目标描述）、`policy`（摘要对象）。

一律不返回：`sshPrivateKey`、`sshPassword`、`sshPassphrase`、`basic_auth_pass`、`basic_auth_user`、`bearer_token`、`oauth_client_secret`、`mqttPassword`、`radiusSecret`、`kafkaProducerSaslOptions`、`databaseConnectionString`、`tlsKey`、`grpcMetadata`、`pushToken`，以及任何 `*password*` / `*secret*` / `*token*` / `*key*` 字段。

`target` 生成规则：HTTP/keyword 型取 `url`，若含 userinfo 或 query 里出现 `key/token/pass/pwd/secret` 参数则替换为 `***`；TCP 型取 `hostname:port`；SSH 型取 `sshUsername@hostname:port` + 命令（命令本身不含凭据）；push 型显示 `—`。

### 7.3 列表聚合新增字段

`Monitor` 增加 `active: boolean`（缺省 `true`）与 `interval: number | null`。来源：聚合时并发调一次 `getMonitorList`（socket，毫秒级），按 id 合并进 status-page 的结果，与 `STATUS_TTL` 同周期缓存。socket 失败时整段降级：`active` 取 `true`、`interval` 取 `null`，不影响页面渲染。

## 8. 接口约定

全部挂在现有 `/api/monitors` 下（`server/routes/monitors.ts`）。所有写接口要求 `Content-Type: application/json`（轻量 CSRF 防护：跨站表单发不出 JSON 请求）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/monitors/:id` | 详情：Kuma 实时配置（白名单）+ 最近 40 拍心跳 + 动作配方 |
| PATCH | `/api/monitors/:id` | 改 name / description / interval / timeout / maxretries / retryInterval / showMsg |
| POST | `/api/monitors/:id/pause` | 暂停（active=0） |
| POST | `/api/monitors/:id/resume` | 恢复（active=1） |
| DELETE | `/api/monitors/:id?confirm=<名字>` | 删除（名字必须全等） |
| POST | `/api/monitors/:id/check` | 立即观测，返回逐步骤结果 |

**GET 响应**

```json
{
  "monitor": { "id": 27, "name": "my-server / 真实 LLM 调用", "type": "keyword", "description": "…",
               "showMsg": true, "interval": 600, "timeout": 60, "maxretries": 1, "retryInterval": 20,
               "active": true, "target": "admin@203.0.113.2:22　sudo /usr/local/bin/wb2-llm-probe.sh",
               "policy": { "name": "llm-on-api-up", "summary": "仅当 app-api 可用时按 600s 检查，否则跳过" } },
  "latest": { "status": 1, "time": "2026-10-21T02:10:00Z", "ping": 4210, "msg": "…" },
  "beats": [{ "status": 1, "time": "…", "msg": "…" }],
  "action": { "source": "default", "steps": [{ "type": "kuma-check", "label": "立刻探测一次" }],
              "disabledReason": null }
}
```

**PATCH 校验**（失败返回 400 `{ error }`）：name 去空白后 1-120 字、不得与其他观测项重名；description ≤ 500 字；interval 20-86400；timeout 1-120 且必须小于 interval；maxretries 0-10；retryInterval 1-3600。改名额外做策略引用检查（见决策 1）。

**PATCH 实现要点**：`getMonitor` 拿全量 → 只覆盖传入字段 → 归一化（`accepted_statuscodes` 保证是字符串数组、`conditions` 保证是数组、`policyJson` 保证是字符串或 null）→ `editMonitor` 整体回传。Kuma 侧会因 `isActive` 自动 `restartMonitor`，改动立即生效。

**DELETE**：`confirm` 与当前名称不一致返回 400；否则先备份 `kuma.db` → `deleteMonitor(id, false)` → 返回 `{ ok: true, backup: "backups/kuma-20261021-103000.db" }`。

**POST /check 响应**

```json
{ "ok": true, "steps": [
  { "type": "http", "label": "触发一键出发", "ok": true, "ms": 132,
    "summary": "一键出发已启动：3 个已勾选账号将顺次执行（号间错峰 15 分钟）" },
  { "type": "command", "label": "刷新 Kuma 心跳", "ok": true, "ms": 2140, "summary": "已推送心跳 [黄]" }
] }
```

失败时 `ok:false`，`steps` 保留已执行的步骤，最后一步带 `error`；`hint` 一并返回给前端展示。

## 9. 写后一致性（三件事，缺一件你都会以为没生效）

1. **清 pinboard 缓存**：`routes/monitors.ts` 导出 `invalidate()`，清掉模块级 `cache`、`statusCache`、`beatCache`；写路由成功后立刻调用。
2. **重生成 `kuma/SNAPSHOT.md`**：spawn `node E:/bqj/kuma/tools/snapshot.cjs`，防抖 1.5 秒（与 pinboard 自己的 snapshot 机制对齐），失败只记日志。
3. **前端强制刷新**：写操作成功后 `load(true)`（带 `?fresh=1`），抽屉里的字段用返回值就地更新，不整块重载。

「立即观测」触发后**不**碰 status-page（避免 5-30 秒的慢查询），改为每 2 秒调一次 `GET /api/monitors/:id`（走 socket，毫秒级），直到 `latest.time` 变化或 60 秒超时；拿到新结果后再做一次常规 `load()`。

## 10. 前端设计

### 10.1 入口

- `MonitorsPage` 增加 `openId: number | null`；网格卡片整体 `onClick`、表格行 `onClick` 打开抽屉；卡片标题旁的 ↗ 链接 `stopPropagation`，仍跳管理页。
- 抽屉打开期间**暂停 30 秒轮询**（避免刷新把正在编辑的表单冲掉），关闭后恢复并 `load()` 一次。

### 10.2 `web/components/MonitorDrawer.tsx`（新，复用 `ui.tsx` 的 `Drawer` / `Button` / `Field` / `Spinner`）

从上到下：

1. **头部**：状态点 + 名称（可内联编辑）+ 类型徽章 + 分组名。
2. **本次观测**：状态、相对时间（复用 `format.ts`）、耗时、消息（等宽、可换行）。
3. **最近 40 拍**：复用 `MonitorCard` 的心跳条渲染（抽成小组件 `BeatStrip`，两处共用）。
4. **基础信息表单**：名称、介绍（textarea 3 行）、频率（数字输入 + 30/60/300/600 快捷 chip + 人类可读提示「每 10 分钟」）、高级折叠（超时 / 重试次数 / 重试间隔）、`showMsg` 开关。
5. **策略**：只读一行（策略名 + 摘要），带提示「配了策略时，频率由策略决定，固定频率可能被覆盖」。
6. **立即观测**：按钮 + 配方来源提示 + 上次执行结果（逐步骤 ✔/✘ + 摘要 + 耗时）；运行中禁用并显示 Spinner。
7. **底部动作条**：保存（有改动时高亮）/ 暂停·恢复 / 删除（danger）。

删除确认：点「删除」后第 6、7 区块整体替换为确认面板——红字说明「会连同历史心跳一起删除」，输入框要求手输观测项名称，按钮在名称全等前保持禁用。

### 10.3 `web/lib/api.ts`

新增类型 `MonitorDetail`、`MonitorPatch`、`ActionStep`、`CheckResult`，以及 `api.monitors.detail / update / pause / resume / remove / check` 六个方法。`Monitor` 类型补 `active?: boolean`、`interval?: number | null`。

### 10.4 样式

复用 `.drawer` 与 `.asset-drawer` 的表单类；新增少量 `.monitor-drawer-*`（本次观测块、策略行、步骤结果行、危险按钮）。深色主题跟随既有 CSS 变量，不新增硬编码颜色。

## 11. 错误处理

| 场景 | 行为 |
|---|---|
| Kuma 没起来 / socket 连不上 | 写接口 502 `{ error: "Kuma 没响应：<原因>。先 kuma.ps1 restart" }`；抽屉顶部红条提示 |
| `editMonitor` 校验失败（Kuma 返回 ok:false） | 原样透出 Kuma 的 msg，表单保留用户输入 |
| 删除时名字不匹配 | 400，输入框标红 |
| 立即观测时观测项已暂停 | 400「先恢复再立即观测」 |
| 打卡面板没启动（`http` 步骤 ECONNREFUSED） | 该步失败，展示配方的 `hint` |
| 同一观测项重复点「立即观测」 | 409「上一次立即观测还在跑」 |
| 详情里 latest 为空（从没跑过） | 显示「还没有心跳记录」 |
| `monitor-actions.json` 写坏了 | 记日志、回退空数组，UI 按「无配方」处理（轮询型仍有默认 kuma-check） |

## 12. 测试计划

**新增 `tests/e2e-monitor-drawer.mjs`**（Playwright，风格与 `tests/e2e-mail.mjs` 一致，自带断言计数），目标 ≥ 30 条：

1. 点卡片开抽屉、Esc/遮罩关闭；表格视图行点击同样能开。
2. `GET /api/monitors/1` 响应**不含**任何敏感字段（逐个字段名断言）。
3. 改名 → 200 → 列表卡片标题立刻更新 → `kuma/SNAPSHOT.md` 的 mtime 变化 → 改回原名。
4. 改频率 60 → 300 → `getMonitor` 读回 300 → 改回 60。
5. 校验：空名字、interval=5、timeout ≥ interval 均返回 400。
6. 暂停 → `active=false`、卡片出现「已暂停」；恢复 → 复原。
7. 立即观测（选 HTTP 型 #2）：触发后 10 秒内 `latest.time` 变化。
8. #24 在面板没启动时点立即观测 → 返回失败且带「面板没启动」提示（不启动面板）。
9. 删除：用 CLI 临时 `add` 一个观测项 → 抽屉删除（名字不匹配先失败一次）→ 状态页消失 → `backups/` 多一份文件；测完清干净。
10. 全程无 console 报错。

**回归**：`smoke` / `e2e` / `e2e-router` / `e2e-filter` / `e2e-mail`（观测页改动可能影响侧栏计数与路由）+ `pnpm typecheck` + `pnpm build`。

**手工验收**：`kuma.ps1 snapshot` 前后对比 `SNAPSHOT.md`；抽屉在 1440x900 与 1280x720 两种视口下不溢出。

## 13. 实施阶段

**阶段 1 · 只读打通**（可独立验收）
- `server/kuma.ts` + `GET /api/monitors/:id` + 列表加 `active`/`interval` + `MonitorDrawer` 展示态（不可编辑）+ 卡片/表格点击入口。
- 验收：点卡片弹详情、字段正确、敏感字段不出网、Esc 关闭、无 console 报错。

**阶段 2 · 写能力**
- `PATCH` / `pause` / `resume` / `DELETE` + `invalidate()` + SNAPSHOT 重生成 + `monitor-links.json` 改按 id + 表单编辑态 + 删除确认面板。
- 验收：改名/改频率立刻生效；暂停后卡片灰「已暂停」；删掉的项从状态页与 SNAPSHOT 消失；`backups/` 有备份。

**阶段 3 · 立即观测**
- Kuma `checkNow` 事件 + `kuma-monitor.cjs check` 子命令 + `monitor-actions.ts` + `POST /check` + `monitor-actions.json` + 抽屉结果区。
- 验收：#27 点一下不等 10 分钟就出新心跳；#24 点一下打卡面板真的开始跑，Kuma 心跳变「正在跑」；面板没启动时提示清楚。

每阶段结束：`pnpm typecheck` 0 错误、`pnpm build` 通过、对应 e2e 全绿，再做下一阶段。

## 14. 风险与坑

1. **全量覆盖**：`editMonitor` 少传字段会清空。必须「先读后改」，并做字段归一化（`accepted_statuscodes` 字符串数组、`conditions` 数组、`policyJson` 字符串）。
2. **敏感字段泄漏**：白名单裁剪在 `kuma.ts` 的返回值出口统一做，别在路由里零散地删。
3. **改名连带影响**：`monitor-links.json`（改按 id）、`policy_json` 里的按名引用（改名时校验并拒绝）、`SNAPSHOT.md`（自动重生成）。
4. **缓存 5 分钟**：写后不清缓存，用户会以为没生效。
5. **`?fresh=1` 慢查询**：触发后等结果只走 socket 详情，不要打 status-page。
6. **打卡面板不常驻**：必须给「面板没启动」的人话提示，而不是 `ECONNREFUSED`。
7. **删除不可逆**：手输名字 + 删前备份，备份保留最近 5 份。
8. **新依赖**：`socket.io-client@~4.8.3`（与 Kuma 同版本，纯 JS，不触发 pnpm 构建白名单）。`pnpm install` 后要重跑 `pnpm build`。
9. **kuma 侧改动需重启**：`kuma.ps1 restart`，改完立刻用 `kuma-monitor.cjs check <id>` 验证。
10. **抽屉与轮询冲突**：抽屉打开时暂停列表轮询，关闭后刷新一次。
11. **上游 AGENTS.md**：只在本地 fork 改，不向上游提 PR。

## 15. 后续（不在本次范围）

- 抽屉里可视化编辑动作配方（需要 `monitor_action` 表 + 表单）。
- 观测项新建（把 `kuma-monitor.cjs add` 的流程搬进 UI）。
- 观测历史曲线 / 可用率趋势。
