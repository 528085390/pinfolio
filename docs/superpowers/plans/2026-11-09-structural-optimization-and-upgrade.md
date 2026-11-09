# pinfolio 结构优化与架构收敛实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 pinfolio 单体系统的工程卫生清理、单测并发稳定性加固、观测台表结构迁移收敛（v4）以及前端重型路由代码分割，全面消除构建警告并提升系统健壮度。

**Architecture:** 
1. 根目录与版本库卫生清理，移除历史测试生成的杂项目录与未跟踪备份；
2. 消除 Vite SSR 单测并发执行时的 WebSocket 监听竞争，并修复 `LinkedTelemetry` 导入混用；
3. 为 `tools/pinboard.ps1` 增加 20MB 日志安全轮转保护（严格保持 UTF-8 带 BOM 编码与 CRLF）；
4. 将内化观测台的 `monitors` 和 `heartbeats` DDL 纳入 `server/migrations.ts` 的 `v4` 版本演进管线，享受自动 pre-migrate 备份；
5. 在 `web/App.tsx` 中对非核心首屏大页面（`MailPage`, `BackupPage`, `ServicesPage`）应用 `React.lazy` 懒加载，减小首屏打包体积。

**Tech Stack:** Node 24 (`node:sqlite`), Hono 4.9, React 19.2, Vite 8.3, TypeScript 5.9, Windows PowerShell 5.1.

**Spec:** 会话内方案 B 规划（工程卫生 + 单测防抖 + 日志轮转 + 迁移收敛 + 前端懒加载）

## Global Constraints

- **commit message 一律英文**（前缀 `fix:` / `feat:` / `docs:` / `chore:`，首行 < 70 字符）。
- **`tools/pinboard.ps1` 必须保存为 UTF-8 带 BOM**（前 3 字节必须是 `239, 187, 191`），`run-pinboard.vbs` 必须保持 CRLF。
- **测试数据严禁写入真实库 `pinboard.db`**。
- **便签与资产互不联动、邮件页严禁任何 `STORE` 操作**。
- **保持 `node:sqlite` 原生能力**，不引入外部第三方 ORM。

## Review Focus

1. `server/migrations.ts` 的 v4 在已有真实库（`monitors` 表已存在且 `user_version = 3`）上执行时必须完全幂等，顺利升至版本 4。
2. `tools/pinboard.ps1` 经历编辑后，PowerShell 5.1 解析必须无报错，通过 BOM 校验。
3. `pnpm test` 全量单测运行中 Vite SSR 渲染不再偶发报 `WebSocket server error: Port 24678 is already in use`。
4. `pnpm build` 输出中消除 `[INEFFECTIVE_DYNAMIC_IMPORT]` 警告，且产物生成独立的 lazy chunk。
5. 7788 运行时健康探测维持 200 OK，前台与后台各项功能不降级。

---

### Task 1: 工作区卫生与冗余清理 (Workspace Hygiene)

**Files:**
- Delete: `e:\bqj\%SystemDrive%`
- Delete: `e:\bqj\NVIDIA Corporation`
- Delete: `e:\bqj\undefined`
- Delete: `e:\bqj\t12-baseline.log`
- Delete: `pinboard\host-services.json.bak-wb2mig-20261102`
- Delete: `pinboard\monitor-links.json.bak-wb2mig-20261102`

**Interfaces:**
- Consumes: None
- Produces: 干净的 `e:\bqj` 根目录与干净的 `pinboard` Git 工作树

- [ ] **Step 1: 删除根目录杂项测试生成目录及冗余日志**
  使用 PowerShell 递归清理 `e:\bqj\%SystemDrive%`, `e:\bqj\NVIDIA Corporation`, `e:\bqj\undefined`, `e:\bqj\t12-baseline.log`。

- [ ] **Step 2: 删除 `pinboard/` 目录中未跟踪的 `.bak` 文件**
  删除 `host-services.json.bak-wb2mig-20261102` 与 `monitor-links.json.bak-wb2mig-20261102`。

- [ ] **Step 3: 验证工作区状态**
  运行：`git status -s` 在 `pinboard/`，确认无未跟踪的 `.bak` 文件；运行 `Get-ChildItem -Path e:\bqj` 确认异常文件夹已清除。

- [ ] **Step 4: Commit（如有受版本控制文件变动）**
  如无版本库改动则此步骤跳过。

---

### Task 2: 修复 Vite SSR 单测并发端口冲突与构建警告

**Files:**
- Modify: `pinboard/tests/unit/monitor-drawer-pin-dom.test.mts`
- Modify: `pinboard/tests/unit/outbound-card-dom.test.mts`
- Modify: `pinboard/web/components/asset-drawer/LinkedTelemetry.tsx`

**Interfaces:**
- Consumes: `createServer` from `vite`, `api` from `web/lib/api.ts`
- Produces: 禁用 WebSocket 的安全 SSR 渲染服务器配置；无动态 import 冲突的组件导入

- [ ] **Step 1: 在 `monitor-drawer-pin-dom.test.mts` 与 `outbound-card-dom.test.mts` 的 `createServer` 中禁用 ws**
  将 `server: { middlewareMode: true, hmr: false }` 改为：
  `server: { middlewareMode: true, hmr: false, ws: false }`。

- [ ] **Step 2: 在 `LinkedTelemetry.tsx` 中修复静态与动态 import 混用**
  定位第 46 行 `const mod = await import('../../lib/api.js')`，替换为直接使用顶部已静态导入的 api 方法或统一导出引用，消除 `[INEFFECTIVE_DYNAMIC_IMPORT]` 告警。

- [ ] **Step 3: 验证单测与构建**
  运行：`cd pinboard; node --import tsx --test "tests/unit/*dom.test.mts"`
  Expected: PASS 无 WebSocket 报错。
  运行：`pnpm build:web`
  Expected: 构建成功且无 `[INEFFECTIVE_DYNAMIC_IMPORT]` 警告。

- [ ] **Step 4: Commit**
  ```bash
  git add tests/unit/monitor-drawer-pin-dom.test.mts tests/unit/outbound-card-dom.test.mts web/components/asset-drawer/LinkedTelemetry.tsx
  git commit -m "fix(test): disable ws in vite ssr test stubs and remove redundant dynamic import"
  ```

---

### Task 3: `tools/pinboard.ps1` 增加安全日志轮转与 BOM 校验

**Files:**
- Modify: `pinboard/tools/pinboard.ps1`

**Interfaces:**
- Consumes: `LogFile` 路径，文件大小检查
- Produces: `Rotate-Log` 函数，在启动前检查若大于 20MB 则轮转为 `pinboard.log.1`

- [ ] **Step 1: 在 `tools/pinboard.ps1` 中增加 `Rotate-Log` 辅助函数并在 `Start-Pinboard` 开头调用**
  函数逻辑：
  ```powershell
  function Rotate-Log {
      if (Test-Path $LogFile) {
          $item = Get-Item $LogFile -ErrorAction SilentlyContinue
          if ($item -and $item.Length -gt 20MB) {
              $rotated = $LogFile + '.1'
              if (Test-Path $rotated) { Remove-Item $rotated -Force -ErrorAction SilentlyContinue }
              Move-Item $LogFile $rotated -Force -ErrorAction SilentlyContinue
              Write-Host ('  日志已超 20MB，已轮转归档至 ' + $rotated) -ForegroundColor DarkGray
          }
      }
  }
  ```

- [ ] **Step 2: 重新写入文件并显式补充 UTF-8 BOM 签名**
  使用 `[System.IO.File]::WriteAllText($p, $content, [System.Text.UTF8Encoding]::new($true))` 保存文件。

- [ ] **Step 3: 验证 BOM 与脚本执行**
  运行：`([System.IO.File]::ReadAllBytes('tools\pinboard.ps1'))[0..2] -join ','`
  Expected: 输出 `239,187,191`。
  运行：`powershell -ExecutionPolicy Bypass -File tools\pinboard.ps1 status`
  Expected: 正常输出服务状态，无任何 ParserError。

- [ ] **Step 4: Commit**
  ```bash
  git add tools/pinboard.ps1
  git commit -m "feat(ops): add log rotation guard in pinboard.ps1 with strict utf8 bom"
  ```

---

### Task 4: 将观测台表结构收纳进 `server/migrations.ts` (v4 演进)

**Files:**
- Create: `pinboard/server/schema/monitor.ts`
- Modify: `pinboard/server/migrations.ts`
- Modify: `pinboard/server/monitor/store.ts`
- Modify: `pinboard/server/app.ts`
- Modify: `pinboard/tests/unit/migrations.test.mts`

**Interfaces:**
- Consumes: `DatabaseSync` from `node:sqlite`, `MONITOR_SCHEMA` from `server/schema/monitor.ts`
- Produces: `MIGRATIONS` 包含 v4（演进至版本 4），`initMonitorTables(db)` 直接使用 `MONITOR_SCHEMA`

- [ ] **Step 1: 提取 `server/schema/monitor.ts` 导出 `MONITOR_SCHEMA`**
  将 `server/monitor/store.ts` 中的建表 SQL 常量抽取为 `export const MONITOR_SCHEMA = ...`。
  `initMonitorTables(db)` 简化为 `db.exec(MONITOR_SCHEMA)`。

- [ ] **Step 2: 在 `server/migrations.ts` 中注册 `v4`**
  引入 `MONITOR_SCHEMA`，定义：
  ```typescript
  function v4(db: DatabaseSync) {
    db.exec(MONITOR_SCHEMA)
  }
  ```
  在 `MIGRATIONS` 数组中追加 `{ version: 4, up: v4 }`。
  更新顶部 `const SCHEMA = [CORE_SCHEMA, MAIL_SCHEMA, METRICS_SCHEMA, ATTACHMENTS_SCHEMA, MONITOR_SCHEMA].join('\n')`。

- [ ] **Step 3: 更新 `server/app.ts`**
  在 `createApp` 初始化数据库时，直接由 `migrate(db, MIGRATIONS, { dataDir: opts.dataDir })` 负责全量演进，不再需要单独外挂 `initMonitorTables(db)`。

- [ ] **Step 4: 更新单测 `tests/unit/migrations.test.mts`**
  在「空库迁移到最新版本，表齐全」断言列表中补充 `'monitors'` 与 `'heartbeats'`。
  添加测试：验证已有 v3 的数据库能够平滑通过 v4 迁移，且表结构完整。

- [ ] **Step 5: 运行迁移单测**
  运行：`cd pinboard; node --import tsx --test "tests/unit/migrations.test.mts"`
  Expected: PASS。

- [ ] **Step 6: Commit**
  ```bash
  git add server/schema/monitor.ts server/migrations.ts server/monitor/store.ts server/app.ts tests/unit/migrations.test.mts
  git commit -m "feat(db): consolidate monitor and heartbeat tables into schema migration v4"
  ```

---

### Task 5: 前端大页面路由代码分割 (React.lazy)

**Files:**
- Modify: `pinboard/web/App.tsx`

**Interfaces:**
- Consumes: `React.lazy`, `Suspense`, `<Spinner />`
- Produces: 动态 import 的 `MailPage`, `BackupPage`, `ServicesPage`

- [ ] **Step 1: 在 `web/App.tsx` 中引入 `Suspense` 与 `lazy`**
  将 `MailPage`、`ServicesPage`、`BackupPage` 替换为：
  ```tsx
  const MailPage = lazy(() => import('./pages/MailPage').then(m => ({ default: m.MailPage })))
  const ServicesPage = lazy(() => import('./pages/ServicesPage').then(m => ({ default: m.ServicesPage })))
  const BackupPage = lazy(() => import('./pages/BackupPage').then(m => ({ default: m.BackupPage })))
  ```
  高频页面（`NotesPage`、`AssetsPage`、`MonitorsPage`、`HostsPage`、`SettingsPage`）维持静态引入，保证首页秒开零闪烁。

- [ ] **Step 2: 在内容渲染区包裹 `<Suspense fallback={<div className="empty"><Spinner /></div>}>`**
  确保异步加载页面期间有统一样式的微加载态指示。

- [ ] **Step 3: 运行全量构建并验证 Chunk 体积**
  运行：`cd pinboard; pnpm build`
  Expected: 构建成功，主 chunk 体积由 617 kB 下降，产生独立的 `MailPage` / `BackupPage` / `ServicesPage` 分包 chunk。

- [ ] **Step 4: Commit**
  ```bash
  git add web/App.tsx
  git commit -m "perf(web): code-split heavy pages (mail, backup, services) via React.lazy"
  ```

---

### Task 6: 全面工程验证与回归测试

**Files:**
- None (纯验证与报告)

- [ ] **Step 1: 运行 TypeScript 类型检查**
  运行：`cd pinboard; pnpm typecheck`
  Expected: 0 errors。

- [ ] **Step 2: 运行全量单测套件**
  运行：`cd pinboard; pnpm test:unit`
  Expected: 740+ 条测试全部通过。

- [ ] **Step 3: 验证服务运行时与健康接口**
  验证 `curl.exe -s http://127.0.0.1:7788/api/health` 返回 `{"ok":true,...}`。

- [ ] **Step 4: 更新实施记录或状态说明**
  在 `pinboard/docs/status-history.md` 追加当日本次优化的完成记录。
  Commit:
  ```bash
  git add docs/status-history.md
  git commit -m "docs: record completion of structural optimizations and v4 schema migration"
  ```
