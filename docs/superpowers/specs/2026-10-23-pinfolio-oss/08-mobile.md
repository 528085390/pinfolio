# 08 · 移动端（已实现）

- 状态：**已实现**（提交 `aab75cb`，已在 `main`）
- 本文只作记录，不再作为待实施项

## 断点与形态

| 宽度 | 形态 |
|---|---|
| > 900px | 左侧 228px 侧栏 |
| 561–900px | 64px 图标栏 |
| ≤ 560px | **底部标签栏**：六个图标 + 文字，高 52px + `safe-area-inset-bottom` |

内容区在 390px 下从「390 − 64 − 32 = 294px」拿回完整的 390px。

## 改动清单

| 文件 | 改动 |
|---|---|
| `web/styles/shell.css` | `.app` 高度用 `100dvh` 兜底 |
| `web/styles/misc.css` | 新增 ≤560px 块：侧栏 fixed 到底部、横向排列、隐藏 brand/foot、`.nav-item` 纵向且 `min-height:52px`、`.page` 底部留 80px + safe-area、toast 上移 |
| `web/styles/controls.css` | ≤560px 输入框 `font-size:16px`（防 iOS 聚焦放大）、按钮最小高度 38px |
| `web/styles/overlay.css` | ≤560px 抽屉满宽、底部按钮让出 safe-area、模态 `max-height:92dvh` |
| `web/styles/hosts.css` | 网格 `minmax(min(330px,100%),1fr)`；`.host-sum` 允许换行 |
| `web/styles/assets.css` | 网格 `minmax(min(292px,100%),1fr)`；≤560px 表格横向滚动、隐藏字段表 key 列 |
| `web/styles/notes.css` | ≤560px 隐藏编辑器底栏提示 |
| `web/styles/mail.css` | ≤560px「列表 / 正文二选一」；工具条 chips 独占一行横向滑动；读信时 `:has()` 收起工具条 |
| `web/pages/mail/MailPage.tsx` | `mail-body is-reading` 切换 + 「返回列表」按钮 |
| `web/pages/mail/useInbox.ts` | 新增并导出 `close()` |
| `web/pages/settings/FieldsCard.tsx` | 表格加 `data-fields` 类 |

## 验收方式（已跑过）

390×844、`deviceScaleFactor: 2`、`isMobile`、`hasTouch`，逐页断言 `document.documentElement.scrollWidth <= innerWidth` 且无元素右边界越界；邮件页实测「点开只显示正文、返回后回到列表」。六页 + 抽屉全部 `OVERFLOW: none`。

## 遗留

- 只在 Chromium 里验证过，Safari 真机未测（`100dvh` 与 `:has()` 在 iOS 15+ 都支持，理论上没问题）。
