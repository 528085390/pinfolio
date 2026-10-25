# 06 · 观测页：Kuma 风味探测与未配置引导

- 状态：**已实施**（2026-10-26，分支 arch；实施记录见文末）
- 依赖：无（可与 02–05 并行）

## 背景

fork 版 Kuma 在 monitor 上多了 `policy_json` 等扩展，上游原版没有。连到上游时，前端仍会渲染策略编辑器与「立即观测」，对不存在的接口发请求 → 报错。

## 设计

### 风味探测

- 环境变量 `KUMA_FLAVOR`：`auto`（默认）/ `fork` / `upstream`。
- `auto`：首次拉 monitor 列表时看单条记录是否含 `policy_json` 字段 → 有 = fork，无 = upstream；结果缓存 5 分钟；请求失败按 `upstream` 处理（保守，不显示不存在的功能）。
- 暴露给前端：`GET /api/kuma/meta` 返回 `{ flavor: 'fork' | 'upstream', configured: boolean }`。

### 界面差异

| 元素 | fork | upstream |
|---|---|---|
| 策略编辑器 | 显示 | 隐藏 |
| 「立即观测」按钮 | 显示 | 隐藏 |
| 其余（列表、详情、编辑、暂停、删除） | 一致 | 一致 |

### 未配置 Kuma

`KUMA_URL` 未配置（或为空）时，观测页显示一张引导卡：怎么起 Kuma、怎么填 `KUMA_URL`、`docker compose` 里怎么加。不隐藏页面、不报错、不空转。

## 验收

- 单测：风味判定纯函数（含字段缺失、空数组、请求失败三种情况）。
- e2e：无 `KUMA_URL` → 观测页出现引导卡；mock 一个 upstream 响应 → 策略编辑器与「立即观测」都不渲染。

## 不做

- 内置探测（等于重写一个 Kuma）、自动安装 Kuma、改 Kuma 的探测逻辑。

## 实施记录（2026-10-26）

三处与设计不同，都是实现时才发现的：

1. **端点叫 `GET /api/monitors/meta`**，不是设计里的 `/api/kuma/meta`——路由挂在 `api.route('/monitors', monitorsRoute)` 下，跟着走才不用另开一层。
   注意它必须注册在 `GET /:id` **之前**（Hono 按注册顺序匹配，否则 `meta` 被当成观测项 id）。
2. **`configured` 的含义放宽了**：设计写的是「`KUMA_URL` 未配置」，实现是「显式配了 `KUMA_URL`/`KUMA_PASS`，**或者**默认地址 `http://127.0.0.1:3001` 上读得到公开状态页」。
   否则本机已经跑着 Kuma、只是没设环境变量的人，会被塞一张「还没接上」的错卡。读不到状态页、也没有显式配置时才给引导卡。
   判定函数 `decideConfigured(env, reachable)` 单独可测；只有「未显式配置」时才去探那一次状态页（3 秒超时）。
3. **「策略编辑器」从来不存在**：详情抽屉里只有 BasicSection 的只读策略摘要（`m.policy`），上游 bean 没有 `policyJson` 自然不渲染。
   所以 upstream 与 fork 的界面差异实际只剩「立即观测」（`RunSection`），由 `MonitorDrawer` 的 `flavor` prop 控制。

另：风味字段的键是 **`policyJson`（camelCase）**，库里列才叫 `policy_json`——第一版照列名判定，自家 fork 被误判成 upstream（见坑 47）。

验证：`pnpm test:unit` 390 条全绿（新增 `tests/unit/kuma-meta.test.mts` 10 条）；三态实测——
自家 fork（带 `data/kuma-pass.txt` + 本机 3001）→ `{"configured":true,"flavor":"fork"}`；
全新数据 + `KUMA_URL=http://127.0.0.1:9` → `{"configured":true,"flavor":"upstream"}`（显式配置就算配了，页面显示错误而不是引导卡）；
全新数据、不设 `KUMA_URL`、本机 3001 有 Kuma → `{"configured":true,"flavor":"upstream"}`（读得到状态页算配了，没口令登录失败按上游算）。
引导卡截图（`KUMA_SLUG=missing` 制造未配置）：1280×900 与 390×844 都无横向溢出。
