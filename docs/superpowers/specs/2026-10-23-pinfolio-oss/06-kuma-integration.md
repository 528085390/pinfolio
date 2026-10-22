# 06 · 观测页：Kuma 风味探测与未配置引导

- 状态：待实施
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
