# Pinfolio 架构演进：Kuma 观测引擎原生内化设计方案

- **日期**：2026-11-06
- **状态**：Reviewed（经过 Builder Check 架构评审）
- **目标**：彻底淘汰外部独立运行的改造版 Uptime Kuma 2.5.6 进程（端口 3001），在 Pinboard（端口 7788，Node 24 + TypeScript + `node:sqlite`）内部实现轻量、健壮的原生探测引擎，将 Pinboard 升级为真正意义上的**单进程、单数据库、单端口**自治自用服务。

---

## 1. 背景与核心动机

### 1.1 现状与痛点
1. **Kuma 现状早已被砍去前端**：Kuma 原本为完整的开源全栈监控，但在之前改造中，前端 `src/`、`dist/`、`public/` 全删，日常观测与抽屉编辑均在 Pinboard（7788 端口）中通过 HTTP 与 Socket.IO 胶水层完成。
2. **双进程架构沉重且脆弱**：
   - 依赖外部独立 Node.js 进程（3001 端口），占独立系统资源（~120MB+ 内存）；
   - 开机自启需要套 VBS、Windows 计划任务 `KumaObs`、防游离探活脚本与 EcoQoS 提速脚本；
   - 启停复杂：停止计划任务会残留孤儿进程占用 3001，导致端口死锁；
   - 胶水代码臃肿：Pinboard 服务端包含 22 个文件专门用于跟 Kuma 握手中转、Socket.IO 鉴权、缓存分段同步等；
   - 性能问题：Kuma 内部 apicache 过期时并发探测导致状态页接口间歇性长达 5~30s 响应延迟；
   - 安全隐患：3001 端口长期裸奔在本地无外部反代鉴权，而 Pinboard 具备完整的会话与 Token 体系。
3. **实际监控类型极其清晰且收敛**：
   当前运行中的全部 24 个观测项类型仅有 4 种：
   - **HTTP 探测**（9 项）：`GET url`，支持 2xx 状态码校验与关键字匹配；
   - **TCP 端口**（4 项）：TCP 三次握手测试连通性；
   - **SSH 命令**（10 项）：SSH 连接执行只读状态命令（如 `systemctl is-active xray`），退出码 0 为 UP；
   - **Push 推送**（1 项）：外部定时脚本打卡心跳。

### 1.2 预期收益
1. **纯单体架构**：Pinboard 成为工作区唯一服务，对外只占 7788 端口，一键 `start.cmd` / `stop.cmd` 启停。
2. **性能与资源飞跃**：
   - 移除外部 HTTP / Socket.IO 中转，状态页与详情直查本地 SQLite（响应时间从 5000ms+ 直降至 <1ms）；
   - 移除 Kuma 上万个 npm 依赖与无用功能；
   - 释放一个完整的 Node.js 运行实例，节省 100MB+ 物理内存。
3. **架构安全统一**：所有观测项的管理与读写原生继承 Pinboard 的用户登录与 Token 鉴权体系。
4. **运维与备份统一**：数据库完全合并进 `pinboard.db`（WAL 模式），备份与灾备无需再管第二份库。

---

## 2. 目标、非目标与反目标

### 2.1 目标（Goals）
1. **功能 100% 对齐**：支持 HTTP、TCP、SSH、Push 4 种探测类型，支持定时探测、间隔/超时/重试策略、配方系统（`monitor-actions.json` 立即观测）、暂停/恢复、改名与删除。
2. **前端 100% 零破坏兼容**：Pinboard 前端（`MonitorsPage.tsx`、`MonitorDrawer.tsx`、卡片状态色块、心跳条、反向资产徽章、立即观测多步骤回显）接口字段完全兼容，前端无需感知后端探测引擎的重构。
3. **出站模式完整保真**：继续支持全局出站路由（直连 / 代理）以及抽屉内单项钉死模式。HTTP、SSH、TCP 均支持 SOCKS5 代理隧道（满足 `REQUIREMENTS-global-outbound-mode.md` 规范）。
4. **平滑数据迁移**：提供无缝迁移逻辑，首次启动时若 `pinboard.db` 无监控项且 `e:\bqj\kuma\data\kuma.db` 存在，自动将 24 个观测项及其配置（包含 SSH 凭据、出站策略、分组名称、`policy_json`）与最近 100 条心跳导入 Pinboard 本地库。
5. **完整离线与卸载**：在迁移验证完毕后，平滑下线外部 Kuma 计划任务与相关脚本。

### 2.2 非目标（Non-Goals）
1. 不实现 Kuma 那些未被使用的复杂探测类型（如 gRPC、DNS、MQTT、Kafka、Docker 容器监控、SNMP 等）。
2. 不重新实现 Kuma 废弃的旧管理页面或已下线的自带 `/status/obs` HTML 页面。
3. 不合并 `pinboard.db` 以外的外部数据库（主机指标探针 sqlite 仍保持各司其职）。

### 2.3 反目标（Anti-Goals）
1. **禁止引入沉重全栈框架**：不得为了实现探测功能引入 NestJS、Express 或重型 ORM（继续使用 Node 24 原生 `node:sqlite` + 纯函数）。
2. **禁止阻塞事件循环**：所有网络探测（HTTP/TCP/SSH）必须有严格的 Timeout 熔断，探测调度器必须控制并发数（最大并发 6），严禁大批量并发导致主服务事件循环卡顿。

---

## 3. 系统架构与数据模型

### 3.1 数据表设计（合并入 `pinboard.db`）

#### 1. 监控项表 `monitors`
```sql
CREATE TABLE IF NOT EXISTS monitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,            -- 'http' | 'port' | 'ssh' | 'push'
  group_name TEXT DEFAULT '',    -- 分组名称，如 'oj (Oracle · 东京)'
  active INTEGER NOT NULL DEFAULT 1,
  interval INTEGER NOT NULL DEFAULT 60,   -- 探测间隔（秒）
  timeout INTEGER NOT NULL DEFAULT 20,    -- 超时时间（秒）
  maxretries INTEGER NOT NULL DEFAULT 1,  -- 重试次数
  -- 探测目标与参数
  url TEXT,                      -- HTTP 目标 URL
  keyword TEXT,                  -- HTTP 关键字匹配
  invert_keyword INTEGER DEFAULT 0,
  accepted_statuscodes TEXT DEFAULT '200-299',
  hostname TEXT,                 -- TCP / SSH 目标主机
  port INTEGER,                  -- TCP / SSH 目标端口
  -- SSH 专有字段
  ssh_username TEXT,
  ssh_password TEXT,
  ssh_private_key TEXT,
  ssh_passphrase TEXT,
  ssh_auth_method TEXT DEFAULT 'privateKey', -- 'privateKey' | 'password'
  ssh_command TEXT,
  -- Push 专有字段
  push_token TEXT,
  -- 策略与高级选项
  outbound_mode TEXT,            -- null | 'direct' | 'proxy' | 'follow'
  policy_json TEXT,              -- 调度策略（移植 Kuma policy.js 求值器）
  description TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

#### 2. 心跳历史表 `heartbeats`
```sql
CREATE TABLE IF NOT EXISTS heartbeats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  status INTEGER NOT NULL,       -- 1: UP, 0: DOWN, 2: PENDING, 3: MAINTENANCE
  ping INTEGER,                  -- 耗时/延迟 (毫秒)
  msg TEXT DEFAULT '',           -- 探测消息 / 错误原因 / exit code / stdout 截断
  time TEXT NOT NULL,            -- UTC ISO 字符串，如 '2026-11-06T06:22:15.145Z'
  duration INTEGER DEFAULT 0,
  down_count INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_heartbeats_monitor_time ON heartbeats(monitor_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_heartbeats_time ON heartbeats(time DESC);
```

### 3.2 探测调度引擎架构 (`server/monitor/`)

```
server/monitor/
├── engine.ts           # 探测引擎核心生命周期（start, stop, 调度循环, 并发池, probeNow）
├── store.ts            # monitors / heartbeats 数据访问层（CRUD 预编译语句）
├── policy.ts           # 纯函数观测策略求值器（从 Kuma 移植，支持 business-hours 动态频率与维护门控）
├── migrate.ts          # 从 kuma.db 的自动检测与导入迁移工具
├── outbound.ts         # 全局与单个观测项出站代理求解器（direct / socks5h / http）
├── types.ts            # 核心数据模型与类型声明
├── probes/
│   ├── http.ts         # 原生 fetch 探针（支持 2xx、关键字、响应时间、代理）
│   ├── port.ts         # net.Socket TCP 探针（支持直连与 SOCKS5 代理握手，满足出站代理规范）
│   ├── ssh.ts          # 基于 ssh2 的轻量 SSH 执行探针（支持私钥/密码、SOCKS5 链）
│   └── push.ts         # Push 打卡心跳接收逻辑
└── snapshot.ts         # 观测台快照 SNAPSHOT.md 原生生成器
```

### 3.3 探测执行细节与关键策略
1. **HTTP 探针**：
   - 依赖 Node 24 原生全局 `fetch`，设置 `signal: AbortSignal.timeout(timeoutMs)`；
   - 若出站模式为代理，则构造 `ProxyAgent`（支持 HTTP / SOCKS5）注入 `fetch`；
   - 记录 `performance.now()` 计算高精度延迟 `ping`。
2. **TCP 探针**：
   - 直连：使用 Node.js 原生 `net.createConnection({ host, port, timeout })`；
   - 代理：当出站模式为代理时，使用 `socks` 库或轻量 SOCKS5 握手建立连接；
   - 监听 `connect` 事件判定 UP 并注销连接；监听 `timeout` 或 `error` 判定 DOWN。
3. **SSH 探针**：
   - 引入轻量级 pure JS 库 `ssh2`；
   - 支持直连或通过 SOCKS5 代理建立套接字（与现有改造版 Kuma 的 `buildConnectOptions` 完全一致）；
   - 执行 `conn.exec(ssh_command)`，捕获 stdout/stderr 前 200 字符，判定退出码 `code === 0` 为 UP。
4. **Push 探针**：
   - 路由：`GET/POST /api/push/:token`；
   - 在 `server/auth/middleware.ts` 中加入 `PUBLIC` 免密白名单（通过 token 自身鉴权）；
   - 收到请求后写入一条状态为 1 的 heartbeat，消息记录传递的 query 或 body 备注（例如 `[绿] 抖音续火花完成`）。
5. **并发与资源控制**：
   - 采用轻量任务队列，控制最大并发探测数 `MAX_CONCURRENCY = 6`；
   - 避免突发瞬间对外部主机建立过多 SSH 连接。

---

## 4. 路由与前端接口契约

保持与现有前端 `web/lib/api/monitors.ts` 及各页面组件 100% 兼容：
1. **`GET /api/monitors`**：
   - 本地 SQLite 查询，零延迟返回全部观测项的当前状态、心跳条、可用率和元数据。
2. **`GET /api/monitors/:id`**：
   - 返回指定项详情与最近 100 条心跳。
3. **`PATCH /api/monitors/:id`**：
   - 更新数据库并立即刷新调度计划；防抖更新 `SNAPSHOT.md`。
4. **`DELETE /api/monitors/:id`**：
   - 自动备份 `pinboard.db` 到 `data/backups/`，删除监控项与关联心跳。
5. **`POST /api/monitors/:id/check`（立即观测）**：
   - 完整继承 `monitor-actions.json` 多步骤配方机制，配方中的默认探测步直接调用内置引擎的 `engine.probeNow(id)`，保证 #24 抖音触发脚本与多步骤回显 100% 保持现状。（同时将 `/api/monitors/:id/beat` 作为同义别名路由）。
6. **`GET/PUT /api/monitors/outbound`**：
   - 全局代理配置读写保存在 Pinboard 的 `settings` 表中，彻底告别 Kuma 写入。
7. **主机管理（`server/metrics/`）对接**：
   - `server/monitor/store.ts` 导出 `createMonitor`、`deleteMonitor`、`deleteMonitorsByGroup` 强类型方法，供主机添加/删除时直接在进程内安全调用，彻底废弃外部 CLI 调度。

---

## 5. 迁移与兼容性保障方案

1. **自动无损迁移**：
   - 启动 Pinboard 时，若发现 `monitors` 表为空且 `e:\bqj\kuma\data\kuma.db` 存在：
     - 读取 `kuma.db` 的 `monitor`、`heartbeat`、`setting` 表；
     - 自动保留原有 ID、名称、分组、SSH 密钥与命令、出站模式；
     - 导入成功后打印日志，并保留 `kuma.db` 只读备份。
2. **外部打卡脚本无缝切换**：
   - 将 `D:\ai_project\douyin-auto-fire\observability\streak-beat.ps1` 中的推送地址从 3001 改为 7788。
3. **双轨验证机制**：
   - 编写迁移专用单测与校验脚本，比对迁移前后 24 个观测项的配置与当前探测状态是否完全一致。
4. **运维与启动脚本清理**：
   - 更新 `start.cmd`、`stop.cmd`、`tools/pinboard.ps1`；
   - 更新 `scratch/autostart/start-stack.ps1` 与 `PinfolioStack.vbs`，移除对 3001 端口与 `run-kuma.vbs` 的依赖；
   - 停用 Windows 计划任务 `KumaObs`。

---

## 6. 验证计划

1. **单元测试（Unit Tests）**：
   - `tests/unit/probe-http.test.mts`：HTTP 2xx 校验、超时熔断、关键字与非关键字。
   - `tests/unit/probe-port.test.mts`：TCP 端口探活与 SOCKS5 代理建链测试。
   - `tests/unit/probe-ssh.test.mts`：SSH 命令探测、私钥解析与错误转换。
   - `tests/unit/probe-engine.test.mts`：调度周期、重试、立即探测、并发控制。
   - `tests/unit/probe-policy.test.mts`：移植后的策略求值测试（business-hours 动态周期等）。
   - `tests/unit/kuma-migrate.test.mts`：从 `kuma.db` 导入的字段映射与保真度。
2. **集成与端到端测试（E2E Tests）**：
   - 跑通原有全部核心端到端测试（`node tests/run.mjs --only=core`）；
   - 更新 `tests/e2e-monitor-*.mjs`，在隔离测试实例下验证观测页、详情抽屉、改名、改频率、删除、立即观测与警报通知；
   - 验证生产打包：`pnpm build` 与 `pnpm build:desktop:main` 全部编译通过。
