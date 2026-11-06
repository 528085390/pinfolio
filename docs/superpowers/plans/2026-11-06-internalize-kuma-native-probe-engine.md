# Kuma 观测引擎原生内化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底淘汰外部独立运行的改造版 Uptime Kuma 2.5.6（3001 端口），在 Pinboard（7788 端口，Node 24 + TypeScript + `node:sqlite`）内部实现轻量原生的探测引擎与数据存储，实现单进程、单数据库、单端口自治自用服务。

**Architecture:** 在 `server/monitor/` 下构建原生数据存储（`monitors` 与 `heartbeats` 表）、轻量四态探测器（HTTP / TCP / SSH / Push）、纯函数策略引擎与并发控制调度器；重写 `server/routes/monitors.ts` 使前端无感兼容；提供 `kuma.db` 自动数据迁移。

**Tech Stack:** Node.js 24 (`node:sqlite`, `node:net`, global `fetch`), TypeScript, Hono, `ssh2`, `socks`.

**Spec:** `docs/superpowers/specs/2026-11-06-internalize-kuma-native-probe-engine.md`

## Global Constraints
- Node 版本 >= 24.0.0，数据库使用 Node 原生 `node:sqlite`，严禁引入重型 ORM。
- 前端组件（`MonitorsPage.tsx`, `MonitorDrawer.tsx`, `LinkedTelemetry.tsx`）接口契约 100% 保持现状，零前端破坏。
- 全局出站代理规范（直连 / 代理）在 HTTP、TCP、SSH 上必须保真执行。
- 测试必须运行在隔离实例上，严禁污染真实 `pinboard.db`。

## Review Focus
1. SOCKS5 代理下境外 TCP 端口探测（如 AWS 443 / Oracle 443）：必须通过 SOCKS5 握手，禁止绕过代理直连超时。
2. Push 打卡路由免密：`/api/push/:token` 必须加入 `server/auth/middleware.ts` 的 `PUBLIC` 列表，防止外部脚本收到 401。
3. 立即观测与多步骤配方：`POST /api/monitors/:id/check` 必须继续支持 `monitor-actions.json`，确保 #24 抖音触发面板脚本不受影响。
4. 调度并发上限控制：并发探测数限制在 6 以内，防止突发 SSH 握手阻塞事件循环。
5. 观测策略（`policy_json`）：#23 项在夜间（23:00-08:00）必须正确放缓至 1200 秒一次。

---

### Task 1: 监控数据模型、存储层与 Kuma 数据迁移

**Files:**
- Create: `server/monitor/types.ts`
- Create: `server/monitor/store.ts`
- Create: `server/monitor/migrate.ts`
- Test: `tests/unit/probe-store.test.mts`
- Test: `tests/unit/kuma-migrate.test.mts`

**Interfaces:**
- Produces:
  - `initMonitorTables(db: DatabaseSync): void`
  - `MonitorStore`: `getMonitors()`, `getMonitorById(id)`, `insertMonitor(data)`, `updateMonitor(id, patch)`, `deleteMonitor(id)`, `recordHeartbeat(beat)`, `getRecentHeartbeats(monitorId, limit)`, `pruneHeartbeats(days)`
  - `migrateKumaDb(liveKumaDbPath: string, targetDb: DatabaseSync): { migrated: number, beats: number }`

- [ ] **Step 1: 编写数据模型与存储层测试**
  在 `tests/unit/probe-store.test.mts` 中编写测试：验证 `monitors` 和 `heartbeats` 建表、增删改查、级联删除与心跳清理。

- [ ] **Step 2: 编写 Kuma 数据迁移测试**
  在 `tests/unit/kuma-migrate.test.mts` 中编写测试：使用模拟或临时 SQLite 数据库验证从 `kuma.db` 导入 24 个监控项、SSH 密钥、策略与心跳。

- [ ] **Step 3: 运行测试验证失败**
  `pnpm test:unit` 确认新测试文件按预期失败（模块未实现）。

- [ ] **Step 4: 实现 `server/monitor/types.ts`、`store.ts` 与 `migrate.ts`**
  实现 SQLite 表定义、预编译 SQL 语句封装、以及从 `kuma.db` 到 `pinboard.db` 的数据对齐迁移逻辑。

- [ ] **Step 5: 验证测试通过**
  运行 `node --import tsx --test "tests/unit/probe-store.test.mts" "tests/unit/kuma-migrate.test.mts"` 确认全部通过。

- [ ] **Step 6: 提交代码**
  `git commit -m "feat(monitor): implement monitor data store and kuma migration"`

---

### Task 2: 原生探针实现与出站代理集成（HTTP / TCP / SSH / Push）

**Files:**
- Create: `server/monitor/outbound.ts`
- Create: `server/monitor/probes/http.ts`
- Create: `server/monitor/probes/port.ts`
- Create: `server/monitor/probes/ssh.ts`
- Create: `server/monitor/probes/push.ts`
- Modify: `package.json`（引入 `ssh2`, `socks`, 及对应 types）
- Test: `tests/unit/probe-http.test.mts`
- Test: `tests/unit/probe-port.test.mts`
- Test: `tests/unit/probe-ssh.test.mts`

**Interfaces:**
- Consumes: `MonitorRow`, `OutboundConfig` from `server/monitor/types.ts`
- Produces:
  - `probeHttp(monitor, outbound): Promise<ProbeResult>`
  - `probePort(monitor, outbound): Promise<ProbeResult>`
  - `probeSsh(monitor, outbound): Promise<ProbeResult>`
  - `recordPush(token, msg, status): Promise<ProbeResult>`

- [ ] **Step 1: 安装依赖**
  安装 `ssh2`, `socks`, `@types/ssh2`。

- [ ] **Step 2: 编写探针单测**
  - `probe-http.test.mts`: 2xx 校验、超时熔断、关键字匹配、反向关键字。
  - `probe-port.test.mts`: 本地 TCP 端口探测、不可达端口测试。
  - `probe-ssh.test.mts`: 错误类型转换（ECONNREFUSED, ENOTFOUND, client-authentication）。

- [ ] **Step 3: 运行测试验证失败**
  运行测试确认尚未实现而失败。

- [ ] **Step 4: 实现 `outbound.ts` 与各探针**
  - `outbound.ts`: 解析直连 / 代理配置与 Agent 套接字生成。
  - `probes/http.ts`: 基于原生 `fetch` 与 `AbortSignal.timeout`。
  - `probes/port.ts`: 基于 `net.createConnection`，代理模式下使用 `SocksClient`。
  - `probes/ssh.ts`: 基于 `ssh2` Client 执行命令，支持代理套接字。

- [ ] **Step 5: 验证测试通过**
  运行探针单测确认全部通过。

- [ ] **Step 6: 提交代码**
  `git commit -m "feat(monitor): implement native http, tcp, ssh, and push probes"`

---

### Task 3: 观测策略求值器、调度引擎与快照生成器

**Files:**
- Create: `server/monitor/policy.ts`
- Create: `server/monitor/engine.ts`
- Create: `server/monitor/snapshot.ts`
- Test: `tests/unit/probe-policy.test.mts`
- Test: `tests/unit/probe-engine.test.mts`

**Interfaces:**
- Consumes: `MonitorStore`, 探针执行器, `policy.ts`
- Produces:
  - `evaluatePolicy(policy, ctx): PolicyEvaluation`
  - `MonitorEngine`: `start()`, `stop()`, `probeNow(id): Promise<ProbeResult>`, `refreshSchedule()`
  - `renderMonitorSnapshot(monitors, beats): string`
  - `writeMonitorSnapshot(path): void`

- [ ] **Step 1: 编写策略引擎与调度器单测**
  - `probe-policy.test.mts`: 验证 business-hours（白天 60s / 夜间 1200s）、门控条件与 maintenance 状态。
  - `probe-engine.test.mts`: 验证并发控制池（最多 6 并发）、`probeNow` 立即探测写库、重试计数。

- [ ] **Step 2: 运行测试验证失败**
  确认新单测失败。

- [ ] **Step 3: 移植 `policy.ts` 并实现 `engine.ts` 与 `snapshot.ts`**
  - `policy.ts`: 移植原 Kuma 的纯函数策略求值逻辑并添加 TS 类型。
  - `engine.ts`: 构建内存中倒计时任务队列，调度循环，并发 Promise 池，状态判定与重试管理。
  - `snapshot.ts`: 生成 `SNAPSHOT.md`，兼容现有格式。

- [ ] **Step 4: 运行测试验证通过**
  运行 `node --import tsx --test "tests/unit/probe-policy.test.mts" "tests/unit/probe-engine.test.mts"` 确认全绿。

- [ ] **Step 5: 提交代码**
  `git commit -m "feat(monitor): add policy evaluator, probe scheduler engine, and snapshot generator"`

---

### Task 4: 路由与配方系统适配、公开 Push 路由及生命周期装配

**Files:**
- Modify: `server/routes/monitors.ts`
- Modify: `server/monitor/actions.ts`
- Modify: `server/monitor/recipe.ts`
- Modify: `server/auth/middleware.ts`
- Modify: `server/app.ts`
- Modify: `server/index.ts`
- Test: `tests/unit/monitor-routes.test.mts`

**Interfaces:**
- Consumes: `MonitorEngine`, `MonitorStore`
- Produces:
  - REST endpoints: `GET /api/monitors`, `GET /api/monitors/:id`, `PATCH /api/monitors/:id`, `DELETE /api/monitors/:id`, `POST /api/monitors/:id/check`, `GET/PUT /api/monitors/outbound`, `GET/POST /api/push/:token`
  - App 启动时自动调用 `migrateKumaDb()` 与 `engine.start()`，关闭时 `engine.stop()`。

- [ ] **Step 1: 编写路由与配方接口单测**
  测试 `GET /api/monitors` 返回格式与前端严格一致；测试 `/api/monitors/:id/check` 执行配方回显；测试 `/api/push/:token` 免密入库。

- [ ] **Step 2: 运行测试验证失败**
  确认测试失败。

- [ ] **Step 3: 改造 `server/routes/monitors.ts`、`recipe.ts` 并挂载 Push 路由**
  - 将原依赖 Kuma Socket.IO 与 HTTP 的逻辑重写为直连本地 `engine` 与 `store`。
  - 在 `server/auth/middleware.ts` 中为 `/api/push/` 添加免密放行。
  - 在 `server/index.ts` 中注册 `engine.start()` 与进程优雅退出。

- [ ] **Step 4: 运行测试验证通过**
  `pnpm test:unit` 验证全部单测通过。

- [ ] **Step 5: 提交代码**
  `git commit -m "feat(monitor): wire native monitor routes, push endpoint, and engine lifecycle"`

---

### Task 5: 主机管理对接、清理外部 Kuma 依赖与脚本切换

**Files:**
- Modify: `server/metrics/routes.ts`
- Modify: `package.json`（移除 `socket.io-client`）
- Remove: `server/kuma/`（全部 22 个胶水文件由 `server/monitor/` 替代）
- Modify: `D:\ai_project\douyin-auto-fire\observability\streak-beat.ps1`（推送端口 3001 -> 7788）
- Modify: `start.cmd`, `stop.cmd`, `tools/pinboard.ps1`, `scratch/autostart/start-stack.ps1`, `docs/runbook.md`
- Test: `tests/run.mjs`

- [ ] **Step 1: 改造 `server/metrics/routes.ts`**
  改掉原有调 `server/kuma/kuma-cli.js` 的实现，改用 `server/monitor/store.ts` 导出的本地强类型增删函数。

- [ ] **Step 2: 删除 `server/kuma/` 胶水目录，卸载 `socket.io-client`**
  清理不再需要的旧跨进程文件，重新运行 `pnpm install`。

- [ ] **Step 3: 更新启动脚本与外部打卡脚本**
  将 `streak-beat.ps1` 的目标端口改为 7788；清理启动脚本中对 3001 的探活与依赖。

- [ ] **Step 4: 运行全量验证**
  - `pnpm typecheck`：0 错误
  - `pnpm test:unit`：全部通过
  - `pnpm build` & `pnpm build:desktop:main`：成功
  - `node tests/run.mjs`：全量端到端测试绿灯

- [ ] **Step 5: 提交代码**
  `git commit -m "chore(monitor): retire external kuma, cleanup glue code and scripts"`
