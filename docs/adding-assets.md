# pinfolio 录入手册：加资产、加便签（给后续会话）

**一句话**：这个应用有两页——「便签」（随手记 Markdown，`#标签` 自动归类）和「资产」（台账）。本手册覆盖**两页的录入**：加资产 = 网页点「登记资产」或 `POST /api/assets`；加便签 = 顶部输入框写完 `Ctrl/⌘ + Enter` 或 `POST /api/notes`。两页互相独立、互不依赖。

面向对象：被派来「把某台服务器 / 域名 / 账号 / 设备登记进台账」或「把一段笔记存成便签」的会话（人或 agent）。读完这一篇就能独立完成，**不需要再读源码**。文中标「实测」的结论都是 2026-10-19 在本机 `127.0.0.1:7788` 上打真请求验证过的。

---

## 读之前：五条硬规则

1. **只监听 127.0.0.1、没有鉴权**。只能在本机操作；数据库是明文 SQLite，**不要往里写明文口令**，`secret_at` 只写「钥匙放在哪」。
2. **资产 `name` 必填**，其余字段全部可选。只传 `name` 也能建成（`kind` 默认 `device`、`status` 默认 `active`）。
3. **便签 `content` 必填**，空串 / 纯空格 → `400 内容不能为空`；便签**没有 `tags` 参数**，标签只能写在正文里（见第二部分）。
4. **想给资产加一个新字段，必须先在 `field_defs` 里定义 key**。否则值会存进 `custom` 但网页上**不显示**（卡片只显示前 2 个有值的自定义字段，详情抽屉只渲染已定义的字段）。
5. **两个页面是独立的**：便签可以不挂资产，资产也不必带便签。便签挂资产只是可选字段 `assetId`（当前 4 条真实便签一条都没挂），别为了「看起来完整」去硬挂。

---

## 第 0 步：确认服务在跑（两页共用）

```powershell
Invoke-RestMethod http://127.0.0.1:7788/api/health
# ok=True, db=D:\pinfolio\data\pinboard.db
```

没跑就启动（任选其一）：

```powershell
& D:\pinfolio\start.cmd          # 后台隐藏启动（日志 logs\pinboard.log），已在运行就只开浏览器
& D:\pinfolio\tools\pinboard.ps1 start   # 同上，纯命令行版
cd D:\pinfolio; pnpm start        # 手动前台跑，关掉窗口即停（调试用）
```

端口被占（`EADDRINUSE 127.0.0.1:7788`）时先清残留进程，再启动：

```powershell
& D:\pinfolio\tools\pinboard.ps1 stop    # 结束整条 pinboard node 链并等 7788 释放
```

---

## 第一部分：加资产（`POST /api/assets`）

### 第 1 步：先查重（按名字 / 别名）

```powershell
Invoke-RestMethod 'http://127.0.0.1:7788/api/assets?q=my-server' | Select-Object id,name,kind,status
```

`q` 是模糊匹配，会同时搜 `name / vendor / serial / location / notes / custom / url`（不搜 kind、status）。

- 已经存在 → **改它**（`PATCH /api/assets/:id`），不要新建第二条。
- 机器退役 / 失联 → 改 `status`，**不要删记录**。

---

### 第 2 步：选录入方式

| 方式 | 适合 | 入口 |
|---|---|---|
| 网页 | 人工填写、随时改 | 资产页右上「登记资产」；或 `Ctrl / ⌘ + K` 输入「登记资产」 |
| HTTP API | agent、批量、要可复现 | `POST http://127.0.0.1:7788/api/assets` |
| 脚本 | 一次录一批 | 参考 `tools/seed-assets.mjs` 的写法（见下文模板） |

**网页路径**

1. 打开 http://127.0.0.1:7788 → 左侧「资产」。
2. 右上「登记资产」→ 右侧抽屉填表 → 保存（抽屉标题变成「资产详情」即成功）。
3. 新增自定义字段：左侧「设置」→「自定义资产字段」→ 填 **显示名 / key / 类型**（选「单选」时再填逗号分隔的选项）→「添加字段」。字段对所有资产通用。

**API 路径**

```powershell
$api = 'http://127.0.0.1:7788/api'
$body = @{
  name = 'new-server-1'; kind = 'server'; status = 'active'
  tags = @('服务器','运维')
  custom = @{ ip = '1.2.3.4'; login = 'root（免密 sudo）' }
  notes = '一句话说明。'
} | ConvertTo-Json -Depth 6 -Compress

Invoke-RestMethod -Method Post -Uri "$api/assets" -ContentType 'application/json' -Body $body
```

成功返回 **201** + 完整对象（`id` 就在里面）。请求体含中文时优先用 `Invoke-RestMethod`；用 `curl.exe` 建议把 JSON 写进文件再 `--data-binary '@asset.json'`，避免 PowerShell 引号与编码问题。

---

### 资产字段表（`POST` / `PATCH` 请求体）

| 请求字段 | 含义 | 类型 | 默认 | 注意 |
|---|---|---|---|---|
| `name` | 名称 | string | — | **必填**；空串或纯空格 → `400 资产名称不能为空` |
| `kind` | 类型 | string | `device` | 见枚举；后端不校验 |
| `status` | 状态 | string | `active` | 见枚举；后端不校验 |
| `location` | 位置 / 归属 | string | `''` | 例：`阿里云 · 北京（轻量应用服务器）` |
| `vendor` | 供应商 | string | `''` | 例：`阿里云` / `DigitalPlat` |
| `serial` | 序列号 / 编号 | string | `''` | 可放订单号、账号 ID |
| `price` | 价格 | number \| null | `null` | 传 `''` / `null` = 未填；**传非数字会静默变 null**（`Number()` → NaN → 落库 NULL，实测） |
| `currency` | 币种 | string | `CNY` | 有符号的：`CNY ¥`、`USD $`、`EUR €`、`JPY ¥`、`GBP £`、`HKD HK$`；其他按 `代码 金额` 显示 |
| `purchasedAt` | 购买日期 | string \| null | `null` | 只取前 10 位 → 统一存 `YYYY-MM-DD` |
| `expiresAt` | 到期 / 续费日 | string \| null | `null` | 同上；**只有这个字段参与到期提醒** |
| `url` | 链接 | string | `''` | 填了就在卡片右下角出现「打开」按钮（新标签页打开），表格视图名称后也有 ↗。**填「管理/控制台入口」而不是产品站点本身**：域名填注册商面板、账号填控制台、服务器填面板（与现有 GLaDOS=console、az=面板一致） |
| `notes` | 备注 | string | `''` | 支持 Markdown；搜索会搜它 |
| `custom` | 自定义字段 | object | `{}` | **整体替换**语义，见下 |
| `tags` | 标签 | string[] | `[]` | **整体替换**；非数组会被静默忽略（实测传字符串不报错也不生效） |

返回对象是 camelCase（`purchasedAt` / `expiresAt` / `createdAt` / `updatedAt`），并额外带 `tags`（`{id,name,color}[]`）和 `noteCount`。

**枚举（前端只认这些值）**

| 值 | 用于 | 显示 | 列表排序 |
|---|---|---|---|
| `device` | `kind` | 设备 | — |
| `server` | `kind` | 服务器 | — |
| `account` | `kind` | 账号 | — |
| `domain` | `kind` | 域名 | — |
| `other` | `kind` | 其他 | — |
| `active` | `status` | 在用 | 1 |
| `idle` | `status` | 闲置 | 2 |
| `retired` | `status` | 退役 | 3 |
| `lost` | `status` | 丢失 | 3 |

后端**不做枚举校验**（实测 `kind='weird-kind'`、`status='weird-status'` 都能 201 存进去），但乱填会让筛选、图标、状态点退化，别这么干。

---

### 自定义字段（`custom`）

现有 4 个（`GET /api/fields` 实测）：

| key | 显示名 | 类型 | 选项 |
|---|---|---|---|
| `secret_at` | 密钥 / 凭证位置 | text | — |
| `renew_cycle` | 续费周期 | select | 月付 / 季付 / 年付 / 买断 |
| `ip` | IP / 地址 | text | — |
| `login` | 登录方式 | text | — |

**先定义、后使用**：

```powershell
$field = @{ key = 'region'; label = '机房区域'; type = 'select'; options = @('北京','广州','东京') } |
  ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri "$api/fields" -ContentType 'application/json' -Body $field
```

- `key` 正则 `^[a-zA-Z][a-zA-Z0-9_]*$`，重复 → `409 key 已存在`（实测）。
- `type` 只能是 `text` / `number` / `date` / `url` / `select` / `bool`，非法值静默变成 `text`。
- `sort` 不用传，自动 = 现有最大值 + 10（决定抽屉里的显示顺序）。
- 值的类型约定（**存储不校验**，但前端按类型渲染）：`date` 用 `YYYY-MM-DD`，`bool` 用 `true/false`，`number` 用数字，`select` 用 options 里的字符串。
- 删字段：`DELETE /api/fields/:id`。已填的值留在数据里但不再显示（网页上会提示这一点）。

---

### 标签（资产与便签共用同一套）

`tags` 传数组即可，元素带不带 `#` 都行（会自动 trim 并去掉开头 `#`）：

- 不存在的标签**自动创建**，颜色按名字 hash 分配；
- 重复元素忽略；
- 资产和便签**共用同一套标签**（这也是做进一个应用的原因）；
- 资产页的标签下拉只显示「有资产在用」的标签，完整列表在设置页。
- 资产卡片上显示**全部**标签（2026-10-19 改；此前只显示前 3 个，第 4 个以后会被吞掉），标签多时自动换行。

现有 21 个标签里，资产常用的：`服务器`、`运维`、`代理`、`域名`、`硬件`、`本机`、`MyApp`。

---

### 四类资产模板（直接改字段就能跑）

先加载一次小工具函数：

```powershell
$api = 'http://127.0.0.1:7788/api'

function Add-Asset([hashtable]$body) {
  $json = $body | ConvertTo-Json -Depth 6 -Compress
  try {
    $a = Invoke-RestMethod -Method Post -Uri "$api/assets" -ContentType 'application/json' -Body $json
    'OK   #{0}  {1}' -f $a.id, $a.name
  } catch {
    'FAIL {0} -> {1}' -f $body.name, $_.ErrorDetails.Message
  }
}
```

**服务器**

```powershell
Add-Asset @{
  name = 'new-server-1'; kind = 'server'; status = 'active'
  location = '某某云 · 北京'; vendor = '某某云'
  url = 'https://example.com'
  price = 99; currency = 'CNY'; expiresAt = '2027-10-19'
  tags = @('服务器','运维')
  custom = @{
    ip = '1.2.3.4'
    login = 'root（免密 sudo）'
    secret_at = 'C:\Users\you\.ssh\xxx_ed25519（ACL 已收紧）'
    renew_cycle = '年付'
  }
  notes = @'
Debian 13，2C2G。跑什么、监听哪些端口。

- `xxx.service`（systemd，enabled + active）
- 配置 `/etc/xxx/config.json`
- 坑：…
'@
}
```

**域名**

```powershell
Add-Asset @{
  name = 'example.com'; kind = 'domain'; status = 'active'
  location = '解析到 my-server（203.0.113.2）'; vendor = 'DigitalPlat'
  url = 'https://dashboard.digitalplat.org/domains'   # 注册商面板，不是站点本身
  expiresAt = '2027-03-01'
  tags = @('域名','运维')
  custom = @{ ip = '203.0.113.2'; renew_cycle = '年付' }
  notes = '未备案。443 由 my-server 的 nginx 提供，证书 acme.sh 自动续。'
}
```

域名资产的 `url` 指向**注册商管理面板**（DigitalPlat 是 `https://dashboard.digitalplat.org/domains`，换注册商就换这条），站点本身/网关入口写在 `notes` 里。

**账号 / 订阅**

```powershell
Add-Asset @{
  name = 'OpenAI 主账号'; kind = 'account'; status = 'active'
  vendor = 'OpenAI'; serial = 'user@example.com'
  price = 20; currency = 'USD'; expiresAt = '2026-11-19'
  tags = @('账号','订阅')
  custom = @{ secret_at = '1Password / AI'; renew_cycle = '月付' }
  notes = '每月自动续，主账号。'
}
```

**设备**

```powershell
Add-Asset @{
  name = 'ThinkPad X1 Carbon'; kind = 'device'; status = 'active'
  location = '书房'; vendor = 'Lenovo'; serial = 'PF3XXXXX'
  price = 12999; currency = 'CNY'; purchasedAt = '2025-05-01'; expiresAt = '2027-05-01'
  tags = @('硬件')
  notes = '主力开发机，三年上门保修。'
}
```

---

### 批量录入脚本模板

`tools/seed-assets.mjs` 是现有 8 条资产的来源，但它**开头会 `DELETE` 掉全部资产再重建**——已有台账时**千万别跑它**。批量补录请用下面这个「按 name 幂等」的版本，存成 `tmp/add-assets.mjs` 再 `node tmp/add-assets.mjs`：

```js
const BASE = 'http://127.0.0.1:7788'
const api = async (path, opts = {}) => {
  const res = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...opts })
  const text = await res.text()
  if (!res.ok) throw new Error(path + ' -> ' + res.status + ' ' + text)
  return text ? JSON.parse(text) : null
}

// 1) 需要的新字段先建（已存在会 409，忽略即可）
const haveFields = new Set((await api('/api/fields')).map((f) => f.key))
for (const f of [{ key: 'region', label: '机房区域', type: 'text' }]) {
  if (!haveFields.has(f.key)) await api('/api/fields', { method: 'POST', body: JSON.stringify(f) })
}

// 2) 按 name 精确查重
const existing = await api('/api/assets')
const byName = new Map(existing.map((a) => [a.name, a]))

const want = [
  { name: 'new-server-2', kind: 'server', status: 'active', tags: ['服务器', '运维'],
    custom: { ip: '5.6.7.8', login: 'root', region: '东京' },
    notes: '一句话说明。' },
]

for (const a of want) {
  const hit = byName.get(a.name)
  if (hit) {
    await api('/api/assets/' + hit.id, { method: 'PATCH', body: JSON.stringify(a) })
    console.log('updated', a.name, hit.id)
  } else {
    const created = await api('/api/assets', { method: 'POST', body: JSON.stringify(a) })
    console.log('created', a.name, created.id)
  }
}

const list = await api('/api/assets')
console.log('assets now:', list.length)
console.log(list.map((a) => a.id + ' ' + a.name + ' [' + a.kind + '/' + a.status + ']').join('\n'))
```

> `PATCH` 的 `custom` 是整体替换——脚本里传的 `custom` 必须包含该资产原有的全部 key，否则会丢。

---

### 录入后自检

```powershell
Invoke-RestMethod "$api/assets/13" | ConvertTo-Json -Depth 6     # 单条回读：custom 是对象、tags 有名字、日期是 YYYY-MM-DD
Invoke-RestMethod "$api/stats"                                    # assets 数 +1；totalValue 变化
```

网页侧：资产页刷新（无 WebSocket，必须手动刷新）→ 卡片出现；`expiresAt` 在 30 天内会高亮成橙色，过期变红。

`/api/stats` 口径：`totalValue` 只累加 `status <> 'retired'` 的 `price`，且**跨币种直接相加**，别当财务数据；`expiringSoon` = 0–30 天，`expired` = 已过期，两者都排除 `retired`。

---

### 改和删（`PATCH` / `DELETE`）

`PATCH /api/assets/:id` 是**合并**：不传的字段保持原值（实测只传 `name`，`custom` 和 `tags` 都还在）。

但 `custom` 和 `tags` 是**整体替换**：

- 传 `custom` → 旧 `custom` 全部丢弃（实测 `{custom:{login:'x'}}` 之后 `ip` 没了）。要保留就先 `GET` 回来合并再 `PATCH`。
- 传 `tags` → 旧标签集合被替换；不传则不动。
- 传非数组的 `tags` → 静默忽略。

`DELETE /api/assets/:id` 是硬删除；关联便签**保留**，只是 `assetId` 置空（外键 `ON DELETE SET NULL`）。

---

### 关联便签（可选；当前 0 条使用）

```powershell
# 新建一条便签并钉到资产 5
$n = @{ content = '证书下个月到期，续期前先 dry-run。#运维 #待办'; assetId = 5 } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri "$api/notes" -ContentType 'application/json' -Body $n

# 把已有便签钉过去 / 解绑
Invoke-RestMethod -Method Patch -Uri "$api/notes/1" -ContentType 'application/json' -Body '{"assetId":5}'
Invoke-RestMethod -Method Patch -Uri "$api/notes/1" -ContentType 'application/json' -Body '{"assetId":null}'
```

`GET /api/assets/:id` 会带 `linkedNotes`（已 hydrate 标签），资产抽屉里能看到。

---

### 常见错误对照（资产，都实测过）

| 现象 | 原因 | 处理 |
|---|---|---|
| `400 {"error":"资产名称不能为空"}` | `name` 是空串 / 纯空格 / 没传 | 补 `name` |
| `404 {"error":"资产不存在"}` | id 不存在（或已删） | `GET /api/assets` 确认 id |
| `409 {"error":"key 已存在"}` | 自定义字段 key 重复 | 换 key；要改显示名用 `PATCH /api/fields/:id` |
| `400 {"error":"key 只能用字母开头…"}` | key 不合正则 | 字母开头，只含字母/数字/下划线 |
| 值存进去了但网页不显示 | `field_defs` 里没有这个 key | 先 `POST /api/fields` |
| 标签没生效 | `tags` 传成了字符串 | 传数组 |
| 价格显示为空 | `price` 传了非数字（静默变 null） | 传数字或 null |
| 到期提醒不动 | `status='retired'`（统计排除退役），或日期不是 `YYYY-MM-DD` | 改状态 / 改日期格式 |
| 改完一个字段，别的字段没了 | `PATCH` 时把 `custom` 整体传了半份 | 先 `GET` 合并再 `PATCH` |
| 页面看不到新资产 | 浏览器缓存 / 没刷新 | 刷新页面（数据已落库） |

---

## 第二部分：加便签（`POST /api/notes`）

便签页是打开应用后的默认页（左侧「便签」）。一条便签 = 一段 Markdown 正文 + 从正文里抽出来的 `#标签` + 几个开关（置顶 / 完成 / 归档）。

**和资产页的关系**：两页各自独立。加便签**不需要**先有资产，`assetId` 只是可选字段（挂上后卡片上多一个资产入口），当前 4 条真实便签都没挂；反过来资产也不必带便签。

### 第 1 步：网页录入（最快）

1. 打开 http://127.0.0.1:7788 （默认就是便签页）。
2. 顶部输入框直接写，`#标签` 写在正文里就会被自动归类。
3. `Ctrl / ⌘ + Enter` 保存（输入框右下角有提示）；保存后输入框清空，新便签出现在「全部」区顶部。
4. 想插已有标签：点输入框右上「标签」按钮 → 弹层里点一下即把 `#名字` 插进正文；建新标签用弹层底部或筛选行的「＋ 新标签」。

写完之后的常用操作都在卡片上：

| 操作 | 怎么做 |
|---|---|
| 标记完成 / 取消 | 卡片左侧圆圈按钮，或**双击卡片正文**（双击按钮 / 链接 / 标签 / 编辑框不触发） |
| 置顶 | 卡片右上图钉按钮；置顶区固定在列表最上方 |
| 编辑 | 铅笔按钮 → 改完 `Ctrl/⌘ + Enter` 或点「保存」 |
| 归档 | 卡片右上「归档」按钮（Archive 图标），便签立刻从默认列表消失，进「已归档」视图 |
| 筛选 | 顶部 chips：全部 / 未完成 / 已完成 / 置顶 / 各标签 / ＋新标签 / **已归档**（带条数） |
| 恢复 / 永久删除 | 只有进「已归档」视图才能做：卡片上「恢复」（回到默认列表）与「永久删除」（红色，**有确认弹窗**「永久删除这条便签？不可恢复。」）。默认视图**没有删除按钮** |
| 搜索 | 右上搜索框，防抖 220ms，匹配正文（`content LIKE %q%`） |

### 第 2 步：API 录入

```powershell
$api = 'http://127.0.0.1:7788/api'
$body = @{
  content = "证书下个月到期，续期前先 dry-run。#运维 #待办"
  pinned  = $true
} | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri "$api/notes" -ContentType 'application/json' -Body $body
```

成功返回 **201** + 完整对象（含 `tags` 数组，元素是 `{id,name,color}`）。

| 请求字段 | 含义 | 类型 | 默认 | 注意 |
|---|---|---|---|---|
| `content` | 正文（Markdown） | string | — | **必填**；空串 / 纯空格 → `400 内容不能为空`（实测；`PATCH` 传空内容同样 400） |
| `pinned` | 置顶 | bool | `false` | 真值判断：`true` / `1` / `"1"` 才算真 |
| `done` | 已完成 | bool | `false` | 同上 |
| `archived` | 归档 | bool | `false` | 归档后默认列表看不到，要 `?archived=1` 或 `?archived=all` |
| `assetId` | 关联资产 | number \| null | `null` | 可选；**必须是已存在的资产 id**，否则 `500 {"error":"FOREIGN KEY constraint failed"}`（实测）；非数字会被静默存成 `null` |

**没有 `tags` 参数**（实测传数组被静默忽略）：标签只能写在正文里。

### 标签是从正文里抽出来的

规则在 `server/db.ts` 的 `TAG_RE`：只有「行首 / 空白 / 中英文标点」之后的 `#` 才被认成标签。

- ✅ `#待办`、`见 #运维`、`（#整理）`、`。#整理`（中文标点也算边界）
- ❌ `abc#tag` —— `#` 前面是字母，不匹配
- 名字允许字母 / 数字 / 中文 / `_` / `-` / `/`；结尾的 `.,;:!?` 会被剥掉
- 不存在的标签**自动创建**，颜色按名字 hash 分配；标签表与资产共用同一套
- 改正文会**重算**标签：先删掉该便签的旧关联，再按新正文重建（实测把正文改成只剩 `#探针己`，旧标签全没了）

### 完成 / 置顶 / 归档 / 恢复 / 编辑 / 删除

`PATCH /api/notes/:id` 只改传进来的字段（`content` / `pinned` / `done` / `archived` / `assetId`），不传的不动：

```powershell
Invoke-RestMethod -Method Patch -Uri "$api/notes/1" -ContentType 'application/json' -Body '{"done":true}'
```

- 列表排序：`pinned DESC, done ASC, created_at DESC`（置顶最前、完成的沉底），上限 `LIMIT 500`
- 网页切换完成态是**乐观更新、不重排**，只有处在「已完成 / 未完成」筛选时才重新拉取
- **归档 ≠ 删除**：`PATCH {archived:true}` 只是把便签移出默认列表（数据全在），`PATCH {archived:false}` 恢复；**网页上只有「已归档」视图里才给「永久删除」按钮**
- `DELETE /api/notes/:id` 硬删除，`note_tags` 随外键级联清掉（标签本身保留）；API 层没有拦，仍可直接调
- 列表默认 `archived=0`；查询参数：`q` / `tag` / `pinned=1` / `done=0|1` / `archived=0|1|all` / `assetId`
- `GET /api/search`（Ctrl+K 命令面板）**只搜未归档**（SQL 里带 `AND archived = 0`），避免搜到归档便签却点不过去

### 批量导入

把一段长文拆成多条便签：按空行切分后逐条 `POST`（不做去重，想幂等就先按 `q` 查一遍）：

```js
const BASE = 'http://127.0.0.1:7788'
const post = (b) => fetch(BASE + '/api/notes', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
}).then((r) => r.json())

const text = `...`   // 你的 Markdown
for (const chunk of text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)) {
  const n = await post({ content: chunk })
  console.log('created', n.id, n.tags.map((t) => t.name).join(','))
}
```

### 常见错误对照（便签）

| 现象 | 原因 | 处理 |
|---|---|---|
| `400 {"error":"内容不能为空"}` | `content` 空 / 纯空格 / 没传 | 补内容 |
| 标签没生效 | 写成 `abc#tag`（`#` 前没边界），或用了全角 `＃` | `#` 前加空格，用半角 `#` |
| 传了 `tags` 数组没反应 | 便签没有 `tags` 参数 | 把标签写进正文 |
| `500 FOREIGN KEY constraint failed` | `assetId` 指向不存在的资产 | 先 `GET /api/assets` 拿真 id，或干脆不传 |
| 新便签看不见 | 处在「已完成」/ 某标签筛选下，或搜索框有残留 | 点「全部」、清空搜索 |
| 归档的便签消失 | 这是设计如此，默认 `archived=0` | 点筛选行「已归档」chip；或 `GET /api/notes?archived=all` |
| 找不到删除按钮 | 2026-10-20 起「删除」改成「归档」 | 进「已归档」视图才有「永久删除」 |
| 改完正文标签变了 | 设计如此：正文变 → 标签重算 | 把想留的标签写进新正文 |
| 顺序不像纯按时间 | 置顶在前、完成的沉底 | 正常行为 |

---

## 附录 A：录入规范（跟现有 8 条对齐）

1. **服务器用主机别名当 `name`**：`my-server`、`az`、`oj`、`aws`、`os`、`ox`（与 `C:\Users\you\.ssh\config` 的 Host 别名、Kuma 分组、主机页采集端 id 一致；2026-10-22 统一，旧名 `azfree` / `oracle-proxy` / `aws-oregon` 只保留在历史正文里）。
2. **退役 / 失联写进名字后缀 + 改状态**：`my-server（已废弃）` + `retired`、`us-162（已失联）` + `lost`。**不删记录**，历史也是信息。
3. **服务器类必填三个 custom**：`ip`、`login`、`secret_at`。`secret_at` 写钥匙**位置**，不写口令明文。
4. **`notes` 用 Markdown 短列表**：跑什么服务、端口、关键路径、坑。搜索会搜到它。
5. **标签至少两个**：一个类型（`服务器` / `域名` / `账号` / `硬件`）+ 一个用途（`运维` / `代理` / `MyApp`）。
6. **日期一律 `YYYY-MM-DD`**，`expiresAt` 只有填了才会进到期提醒。

---

## 附录 B：要扩展代码时改哪里

| 想做的事 | 改哪 |
|---|---|
| 新增一种资产 `kind` | `web/lib/format.ts` 的 `KINDS` + `KIND_META`；`web/components/KindIcon.tsx` 的 `MAP`（否则图标回落到 Package）。后端无枚举校验，不用改 |
| 新增字段类型 | `server/routes/fields.ts` 的白名单数组；`web/pages/SettingsPage.tsx` 的 `TYPES`；`web/components/AssetDrawer.tsx` 的渲染分支 |
| 改币种下拉 | `web/components/AssetDrawer.tsx` 的 `CURRENCIES`（`format.ts` 的 `SYMBOL` 加符号） |

改前端后必须 `pnpm build` 再刷新；改后端要重启 `pnpm start`（非 watch）。改完跑 `pnpm typecheck`。

---

## 一页速查（资产 + 便签）

```powershell
$api = 'http://127.0.0.1:7788/api'
Invoke-RestMethod "$api/health"                    # 服务在不在
Invoke-RestMethod "$api/stats"                     # 资产数 / 总价 / 到期口径

# —— 资产 ——
Invoke-RestMethod "$api/fields"                    # 现有自定义字段（先定义再用）
Invoke-RestMethod "$api/assets?q=关键词"            # 查重（模糊搜 name/vendor/serial/location/notes/custom/url）
Invoke-RestMethod "$api/assets/5"                  # 单条详情（含 linkedNotes）
Invoke-RestMethod -Method Post -Uri "$api/assets" -ContentType 'application/json' -Body '{"name":"new-server-1","kind":"server","tags":["服务器","运维"]}'
Invoke-RestMethod -Method Patch -Uri "$api/assets/5" -ContentType 'application/json' -Body '{"status":"retired"}'

# —— 便签 ——
Invoke-RestMethod "$api/notes?done=0"              # 未完成；?tag=运维 / ?pinned=1 / ?archived=all
Invoke-RestMethod -Method Post -Uri "$api/notes" -ContentType 'application/json' -Body '{"content":"记一条 #待办"}'
Invoke-RestMethod -Method Patch -Uri "$api/notes/1" -ContentType 'application/json' -Body '{"done":true}'
```

**数据位置**：`D:\pinfolio\data\pinboard.db`（WAL，同目录 `-wal` / `-shm`）。备份 = 停服务后复制整个 `data/`。