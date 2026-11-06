# 阶段一：资产 ↔ 监控/主机双向联动与桌面端全局快速录入便签 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现资产与观测台/主机指标之间的双向联动与可视化交互，以及 Electron 桌面端基于全局快捷键（`Ctrl+Alt+N`）的极速浮窗随手记便签功能。

**Architecture:** 
1. **资产与运维联动**：在 `asset.custom` 中规范 `hostId` 与 `monitorIds` 两个键；新增纯逻辑模块 `web/lib/telemetry-link.ts` 统一计算资产与主机、观测项之间的双向引用与智能推荐；在 `AssetDrawer` 中嵌入实时指标小部件（CPU/内存/磁盘/延迟心跳/立即观测）；并在 `MonitorDrawer` 与 `HostCard` 中增设反向跳转资产的联动徽标。
2. **桌面快捷记事**：在 Electron 主进程中通过 `globalShortcut` 注册 `CommandOrControl+Alt+N`，构建一个轻量级无边框置顶浮窗（540x240），支持 Markdown 与实时 `#tag` 提取，使用当前会话凭据直接 `POST /api/notes` 入库，支持 `Ctrl+Enter` 提交与 `Esc` / 失焦隐藏。

**Tech Stack:** Node 24 + TypeScript + React 19 + Hono + Electron + Vite.

**Spec:** `docs/superpowers/specs/2026-11-06-phase1-linkage-and-quicknote.md`

## Global Constraints

- Node >= 24；`package.json` 是 `type: module`；所有服务端与桌面端内部相对 import 一律带 `.js` 后缀。
- 新增依赖只能进 `devDependencies`，严禁加入 `dependencies`（保障 Docker runtime 镜像体积最小化）。
- 不破坏现有测试：`tests/unit/` 中既有 683 条单测全部保持通过。
- 单测不污染真实数据库：测试用例涉及数据库时必须使用内存或临时目录。
- 保证无无痕破坏：未绑定监控或主机的老资产展示效果完全不受影响。
- 遵循现有多语言架构：所有新增的前端界面文字必须支持中英双语（通过 `t(...)` 与 `shared/i18n/`）。

## Review Focus

1. **自定义字段合并安全性**：更新资产的 `hostId` / `monitorIds` 时，不能覆盖或冲掉用户在 `asset.custom` 里的原有属性（如 `ip` 等用户自定义字段）。
2. **空态与容错**：当关联的主机处于离线或被删除、观测项被删除或 Kuma 探测后端离线时，资产抽屉内的状态卡片必须有优雅的兜底（如显示「未获取到数据」或「项已失效」），严禁组件崩盘。
3. **快捷键防冲突与资源释放**：在应用退出时，`globalShortcut.unregisterAll()` 必须被正确调用；若注册快捷键失败（如被其他软件占用），记录可读日志，托盘菜单仍可作为保底呼出入口。
4. **快速记事失焦与防重复提交**：保存请求进行中时禁用提交按钮，避免连续狂按 `Ctrl+Enter` 插入多条重复便签。
5. **暗色模式统一风格**：快速录入浮窗必须采用 Pinfolio 经典的主题背景颜色 `#111315`，输入框、标签徽标与按钮质感与主应用一致。

---

## Task 1: 联动数据解析与智能匹配纯函数 (Pure Logic)

**Files:**
- Create: `web/lib/telemetry-link.ts`
- Create: `tests/unit/telemetry-link.test.mts`

**Interfaces:**
- Produces:
```ts
export type AssetTelemetry = {
  hostId: string | null
  monitorIds: number[]
}

export function parseAssetTelemetry(custom: any): AssetTelemetry
export function mergeAssetTelemetry(custom: any, telemetry: Partial<AssetTelemetry>): Record<string, any>
export function suggestTelemetry(
  assetName: string,
  assetLocation: string,
  availableHosts: Array<{ id: string; label?: string }>,
  availableMonitors: Array<{ id: number; name: string; group?: string }>
): { suggestedHostId: string | null; suggestedMonitorIds: number[] }
export function findAssetsForHost(hostId: string, assets: Array<{ id: number; name: string; custom?: any }>): Array<{ id: number; name: string }>
export function findAssetsForMonitor(monitorId: number, monitorGroup: string, assets: Array<{ id: number; name: string; custom?: any }>): Array<{ id: number; name: string }>
```

- [x] **Step 1: 编写失败单元测试 `tests/unit/telemetry-link.test.mts`**
测试 `parseAssetTelemetry` 解析、`mergeAssetTelemetry` 保留其余自定义字段、`suggestTelemetry` 根据名字（如 `aws`）自动匹配对应主机与同组监控项、`findAssetsForHost` 与 `findAssetsForMonitor` 反向查找。

- [x] **Step 2: 运行测试验证失败**
`pnpm test:unit`

- [x] **Step 3: 实现 `web/lib/telemetry-link.ts`**
编写纯函数实现，严格处理各种边界情况（null / undefined / 大小写归一化 / 数组去重）。

- [x] **Step 4: 运行测试验证通过**
`pnpm test:unit`

- [x] **Step 5: Git commit**
`git add web/lib/telemetry-link.ts tests/unit/telemetry-link.test.mts && git commit -m "feat(assets): add telemetry link pure utilities and tests"`

---

## Task 2: 资产抽屉联动组件与编辑展示 (Linked Telemetry Section)

**Files:**
- Create: `web/components/asset-drawer/LinkedTelemetry.tsx`
- Modify: `web/components/AssetDrawer.tsx`
- Modify: `web/components/asset-drawer/BasicFields.tsx`
- Modify: `shared/i18n/en/assets.ts`
- Create: `tests/unit/asset-telemetry-ui.test.mts`

**Interfaces:**
- Consumes: `web/lib/telemetry-link.ts`, `web/lib/api.ts` (`api.monitors.list`, `api.hosts.list`), `web/components/asset-drawer/form.ts`
- Produces: `LinkedTelemetry` 组件嵌入 `AssetDrawer`，支持编辑态选择主机与监控、智能一键建议填入；展示态显示机器实时 CPU/内存/磁盘与监控延迟/心跳。

- [x] **Step 1: 编写组件状态与映射单元测试 `tests/unit/asset-telemetry-ui.test.mts`**
测试表单中 `custom.hostId` 与 `custom.monitorIds` 正确参与 payload 拼装与提交，且不影响其它 `custom` 字段。

- [x] **Step 2: 运行测试验证失败**
`pnpm test:unit`

- [x] **Step 3: 实现 `LinkedTelemetry.tsx` 并接入 `AssetDrawer.tsx`**
  - 在抽屉中读取或复用主机清单与监控项数据；
  - 增加主机选择下拉框与监控项多选复选列表；
  - 若有候选智能匹配，展示「一键绑定」快捷操作；
  - 展示态下显示微缩版状态卡片：展示主机指标状态与监控项当前心跳及「立即观测」操作。
  - 完善英文翻译词条。

- [x] **Step 4: 运行测试验证通过**
`pnpm test:unit`

- [x] **Step 5: Git commit**
`git add web/components/asset-drawer/LinkedTelemetry.tsx web/components/AssetDrawer.tsx web/components/asset-drawer/BasicFields.tsx shared/i18n/en/assets.ts tests/unit/asset-telemetry-ui.test.mts && git commit -m "feat(assets): add linked telemetry widget to asset drawer"`

---

## Task 3: 观测台与主机页反向关联徽章 (Reverse Linking)

**Files:**
- Modify: `web/components/MonitorDrawer.tsx`
- Modify: `web/pages/hosts/HostCard.tsx`
- Modify: `shared/i18n/en/monitors.ts`
- Modify: `shared/i18n/en/hosts.ts`
- Modify: `tests/unit/monitor-drawer-form.test.mts`

**Interfaces:**
- Consumes: `web/lib/telemetry-link.ts`, `api.assets.list`

- [x] **Step 1: 编写反向关联逻辑测试**
验证给定观测项 ID 或主机 ID 时，能准确识别关联的资产，并在点击徽章时触发正确的跳转或抽屉唤起。

- [x] **Step 2: 在 `HostCard.tsx` 增加关联资产徽标**
当检测到当前主机存在关联资产时，在卡片右上角或主机标签旁展示 `🔗 资产: <名称>`，点击可切到资产页并打开该资产抽屉。

- [x] **Step 3: 在 `MonitorDrawer.tsx` 增加关联资产信息**
在观测项详情抽屉的基本信息段展示「关联资产」，点击可快捷定位到资产详情。

- [x] **Step 4: 运行测试验证通过**
`pnpm test:unit`

- [x] **Step 5: Git commit**
`git add web/components/MonitorDrawer.tsx web/pages/hosts/HostCard.tsx shared/i18n/en/monitors.ts shared/i18n/en/hosts.ts tests/unit/monitor-drawer-form.test.mts && git commit -m "feat(monitors,hosts): add reverse asset link badges"`

---

## Task 4: 桌面端全局快捷键与随手记浮窗 (Desktop Quick Note Window)

**Files:**
- Create: `desktop/quick-note.ts`
- Create: `desktop/quick-note-html.ts`
- Modify: `desktop/main.ts`
- Modify: `desktop/tray.ts`
- Create: `tests/unit/quick-note.test.mts`

**Interfaces:**
- Produces:
```ts
export function createQuickNoteWindow(targetUrl: string, onClose?: () => void): BrowserWindow
export function registerQuickNoteShortcut(shortcut: string, onTrigger: () => void): boolean
```

- [x] **Step 1: 编写桌面快捷浮窗纯逻辑与参数校验单元测试 `tests/unit/quick-note.test.mts`**
测试窗口选项配置（尺寸 540x240、无边框、置顶、跳过任务栏）、快捷键有效性判断。

- [x] **Step 2: 运行测试验证失败**
`pnpm test:unit`

- [x] **Step 3: 实现 `desktop/quick-note-html.ts` 与 `desktop/quick-note.ts`**
  - 构建独立无依赖的轻量 HTML 界面：包含深色输入框、实时 `#tag` 提取显示、置顶勾选、`Ctrl+Enter` 快捷提交与 `Esc` 关闭；
  - 内部利用浏览器 `fetch('/api/notes', { method: 'POST', ... })` 提交至桌面连接的目标服务，自带 Session 认证；
  - 成功时展示对勾提示并于 400ms 后自动隐藏浮窗。

- [x] **Step 4: 在 `desktop/main.ts` 与 `desktop/tray.ts` 中注册全局热键与托盘菜单项**
  - `globalShortcut.register('CommandOrControl+Alt+N', ...)` 切换浮窗显隐；
  - 托盘右键菜单增加「快速记便签 (Ctrl+Alt+N)」；
  - 应用退出时注销快捷键。

- [x] **Step 5: 运行测试验证通过**
`pnpm test:unit`

- [x] **Step 6: Git commit**
`git add desktop/quick-note.ts desktop/quick-note-html.ts desktop/main.ts desktop/tray.ts tests/unit/quick-note.test.mts && git commit -m "feat(desktop): add global shortcut Ctrl+Alt+N and quick note floating window"`

---

## Task 5: 整体集成与类型检查回归 (Verification & Build)

**Files:**
- All modified files

- [x] **Step 1: 运行全量 TypeScript 类型检查**
`pnpm typecheck`

- [x] **Step 2: 运行全量单元测试套件**
`pnpm test:unit`（确保测试总数只增不减，全部 0 失败）

- [x] **Step 3: 运行构建打包**
`pnpm build`（验证前端 Vite 与服务端打包完全正常，无语法或依赖错误）

- [x] **Step 4: Git commit & 分支收口**
整理 commit 历史，确保干净整洁。
