# pinfolio 数据库调优、心跳生命周期闭环与网络传输压缩实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 SQLite WAL 高性能 PRAGMA 调优、观测台 7 天心跳定时自动清理、Hono 全局 Gzip 传输压缩以及静态资源缓存判定加固，进一步提升系统吞吐与运维可靠性。

**Architecture:** 
1. **数据库层**：在 `server/db.ts` 注入 SQLite 官方推荐的 WAL 模式高性能参数（`synchronous = NORMAL`、`cache_size = -20000`、`temp_store = MEMORY`），大幅减少同步 fsync 磁盘 I/O 阻塞；
2. **生命周期闭环**：在 `ProbeEngine` 中为 `store.pruneHeartbeats(7)` 添加每日定时清理调度（`unref` 定时器），彻底防止 `heartbeats` 表持续膨胀；
3. **网络层**：在 `server/app.ts` 引入 `hono/compress` 提供的 `compress()` 中间件，自动对大 JSON 接口及主 JS 脚本提供 Gzip/Deflate 压缩；
4. **静态缓存加固**：微调 `server/static.ts`，将 `/favicon.ico` 与 `/robots.txt` 排除在一年 immutable 缓存之外，保证图标更新及时生效。

**Tech Stack:** Node 24 (`node:sqlite`), Hono 4.9 (`hono/compress`), TypeScript 5.9.

**Spec:** 会话内性能与存储闭环优化决策（PRAGMA 优化 + 心跳清理 + Gzip 压缩 + 静态缓存细化）

## Global Constraints

- **commit message 一律英文**（前缀 `fix:` / `feat:` / `docs:` / `chore:`，首行 < 70 字符）。
- **`tools/pinboard.ps1` 必须保存为 UTF-8 带 BOM**，`run-pinboard.vbs` 保持 CRLF。
- **测试数据严禁写入真实库 `pinboard.db`**。
- **便签与资产互不联动、邮件页严禁任何 `STORE` 操作**。
- **所有新增定时器必须 `unref()`**，不得阻塞 Node 进程自然退出。

## Review Focus

1. `PRAGMA synchronous = NORMAL` 在 WAL 模式下正常工作，各项单测和事务快照无锁死或异常。
2. `ProbeEngine` 启动时成功排定心跳清理计划，`stop()` 时能完整注销定时器，不泄露 handle。
3. `hono/compress` 中间件对 `accept-encoding: gzip` 请求正确返回 `content-encoding: gzip`，且对静态托管及已有 JSON 接口透明兼容。
4. `/favicon.ico` 访问时的响应头为 `no-cache`，而带 hash 的 `/assets/*.js` 仍然保持 `immutable`。
5. 全量 740+ 单测保持全绿，健康探测 200 OK。

---

### Task 1: SQLite WAL 模式官方最佳性能 PRAGMA 配置

**Files:**
- Modify: `pinboard/server/db.ts`
- Test: `pinboard/tests/unit/db-pragma.test.mts`

**Interfaces:**
- Consumes: `db` from `node:sqlite`
- Produces: 配置了 `synchronous = NORMAL`、`cache_size = -20000`、`temp_store = MEMORY` 的单例连接

- [ ] **Step 1: 编写 PRAGMA 检查单测 `tests/unit/db-pragma.test.mts`**
  ```typescript
  import { test } from 'node:test'
  import assert from 'node:assert/strict'
  import { DatabaseSync } from 'node:sqlite'

  test('SQLite PRAGMA 配置：synchronous 设为 NORMAL(1)', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
    const row: any = db.prepare('PRAGMA synchronous').get()
    assert.equal(Number(row.synchronous), 1)
  })
  ```

- [ ] **Step 2: 运行测试验证**
  运行：`cd pinboard; node --import tsx --test "tests/unit/db-pragma.test.mts"`
  Expected: PASS。

- [ ] **Step 3: 在 `server/db.ts` 中配置 PRAGMA**
  在 `db.exec('PRAGMA busy_timeout = 5000')` 后追加：
  ```typescript
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA cache_size = -20000')
  db.exec('PRAGMA temp_store = MEMORY')
  ```

- [ ] **Step 4: 运行现有数据库单测**
  运行：`cd pinboard; node --import tsx --test "tests/unit/probe-store.test.mts"`
  Expected: PASS。

- [ ] **Step 5: Commit**
  ```bash
  git add server/db.ts tests/unit/db-pragma.test.mts
  git commit -m "perf(db): configure sqlite wal pragmas (synchronous normal, 20mb cache, memory temp store)"
  ```

---

### Task 2: 观测台 7 天心跳定时自动清理调度

**Files:**
- Modify: `pinboard/server/monitor/engine.ts`
- Modify: `pinboard/tests/unit/probe-engine.test.mts`

**Interfaces:**
- Consumes: `MonitorStore.pruneHeartbeats(keepDays = 7)`
- Produces: `ProbeEngine.schedulePrune()` 启动自动排期，并在 `stop()` 时安全注销

- [ ] **Step 1: 在 `tests/unit/probe-engine.test.mts` 中添加心跳定时清理测试**
  断言 `engine.start()` 后能成功调度清理，并在 `engine.stop()` 后清理定时器句柄。

- [ ] **Step 2: 在 `server/monitor/engine.ts` 中实现 `schedulePrune()`**
  在 `ProbeEngine` 中增加属性 `private pruneTimer: NodeJS.Timeout | null = null`。
  定义 `schedulePrune()`：
  - 启动 5 秒后首次调用 `this.store.pruneHeartbeats(7)`；
  - 之后每 24 小时循环调用；
  - 全部定时器均设置 `.unref?.()`。
  在 `stop()` 中注销 `pruneTimer`。

- [ ] **Step 3: 运行测试验证**
  运行：`cd pinboard; node --import tsx --test "tests/unit/probe-engine.test.mts"`
  Expected: PASS。

- [ ] **Step 4: Commit**
  ```bash
  git add server/monitor/engine.ts tests/unit/probe-engine.test.mts
  git commit -m "feat(monitor): schedule daily automatic heartbeat pruning in probe engine"
  ```

---

### Task 3: 启用 Hono 全局 Gzip 传输压缩中间件

**Files:**
- Modify: `pinboard/server/app.ts`
- Create: `pinboard/tests/unit/app-compression.test.mts`

**Interfaces:**
- Consumes: `compress` from `'hono/compress'`
- Produces: 为支持的客户端请求自动返回 Gzip 压缩后的 Response

- [ ] **Step 1: 编写压缩单测 `tests/unit/app-compression.test.mts`**
  使用 Hono 的 `app.request()` 模拟发送 `Accept-Encoding: gzip` 请求，断言返回的 `Content-Encoding` 为 `gzip`。

- [ ] **Step 2: 运行测试确认测试执行逻辑**
  运行：`cd pinboard; node --import tsx --test "tests/unit/app-compression.test.mts"`
  Expected: FAIL (因 app 尚未挂载 compress 中间件)。

- [ ] **Step 3: 在 `server/app.ts` 中挂载 `compress()`**
  ```typescript
  import { compress } from 'hono/compress'
  ...
  app.use('*', compress())
  ```

- [ ] **Step 4: 运行测试验证 PASS**
  运行：`cd pinboard; node --import tsx --test "tests/unit/app-compression.test.mts"`
  Expected: PASS。

- [ ] **Step 5: Commit**
  ```bash
  git add server/app.ts tests/unit/app-compression.test.mts
  git commit -m "perf(server): enable global gzip compression middleware"
  ```

---

### Task 4: 静态资源缓存判定微调（Favicon & Robots 不长缓存）

**Files:**
- Modify: `pinboard/server/static.ts`
- Modify: `pinboard/tests/unit/web-paths.test.mts` 或相关测试

**Interfaces:**
- Consumes: `p` 请求路径
- Produces: 排除 `/favicon.ico` 和 `/robots.txt` 走出长缓存

- [ ] **Step 1: 更新 `server/static.ts` 的 `cacheable` 判定**
  将：
  ```typescript
  const cacheable = !(p === '/index.html' || p.endsWith('.webmanifest') || p.startsWith('/icons/') || p === '/apple-touch-icon.png')
  ```
  更新为：
  ```typescript
  const cacheable = !(p === '/index.html' || p.endsWith('.webmanifest') || p.startsWith('/icons/') || p === '/apple-touch-icon.png' || p === '/favicon.ico' || p === '/robots.txt')
  ```

- [ ] **Step 2: 运行静态资源与路径测试**
  运行：`cd pinboard; node --import tsx --test "tests/unit/web-paths.test.mts"`
  Expected: PASS。

- [ ] **Step 3: Commit**
  ```bash
  git add server/static.ts
  git commit -m "fix(static): prevent long-term immutable caching for favicon.ico and robots.txt"
  ```

---

### Task 5: 全面工程验证与历史归档

**Files:**
- Modify: `pinboard/docs/status-history.md`

- [ ] **Step 1: 运行 TypeScript 类型检查**
  运行：`cd pinboard; pnpm typecheck`
  Expected: 0 errors。

- [ ] **Step 2: 运行全量单测套件**
  运行：`cd pinboard; pnpm test`
  Expected: 全部单元测试与 snippet test 通过。

- [ ] **Step 3: 验证服务运行时与健康接口**
  验证 `curl.exe -s http://127.0.0.1:7788/api/health` 返回 `{"ok":true,...}`。

- [ ] **Step 4: 追加记录并提交**
  在 `docs/status-history.md` 追加当日本次优化的完成记录并提交 Git。
