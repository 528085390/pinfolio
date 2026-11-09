# Pinfolio 视觉升级：Glass 风格 + Apple 动效系统 设计方案

- **日期**：2026-11-09
- **状态**：Draft（待用户审阅，**未批准前不动代码**）
- **目标**：在**不改动任何功能、数据、交互流程**的前提下，给 pinfolio 增加一套可一键切换的 **Glass 风格**（Apple Liquid Glass / macOS 26 观感）与一套 Apple 式动效系统；现有暖纸主题保持**零视觉变化**、可即时回退。
- **一句话**：玻璃只做功能层（侧栏 / 顶栏 / 抽屉 / 弹层 / 命令面板），内容层保持标准材质；动效只用 Apple 出货参数（跟手拖拽 + 速度投影 + spring 0.8/0.3），高频交互不做动画。

---

## 0. 已定决策（用户已确认）

| # | 决策 | 结论 |
|---|---|---|
| 1 | 视觉方向 | 用户选 **C 双主题**：暖纸保留、新增 Glass，设置页一键切 |
| 2 | 动效档位 | **第 2 档「空间连续」**：跟手抽屉、共享元素、主题柔光过渡；**不做**滚动视差与 iOS 大标题收缩（masonry 绝对定位会卡） |
| 3 | 实现路线 | **不自己造轮子**：数值与配方全部取自 Apple HIG、emilkowalski/skills（MIT）、rdev/liquid-glass-react（MIT） |
| 4 | 范围 | 标准毛玻璃 + 真折射**都做**（用户 m00075「都做」）；折射仅 Chromium/Electron 生效，带开关 |
| 5 | 命令面板 | 按 Apple 频率表，⌘K 开合**不加动画**（每天几十上百次）；现有 palette.css 的 animation: pop 也要删 |

### 0.1 调研来源（可复查）

1. **Apple HIG**：`/design/human-interface-guidelines/motion` 与 `/materials`。要点：动效必须有目的；**频繁发生的交互不加动效**；**Don’t use Liquid Glass in the content layer**；玻璃分 regular（文字多，模糊+调亮度）/ clear（只压在图视频上，亮背景加 35% 暗化层）；standard materials 四档 ultraThin→thick。
2. **emilkowalski/skills**（MIT，Vaul/Sonner 作者，译自 WWDC 2018 Designing Fluid Interfaces）：可打断是第一原则、从当前值起动画、不锁输入、手势禁用 @keyframes、速度交接、**动量投影 project(v, decel=0.998)**、**spring 用 damping ratio + response**（抽屉 0.8 / 0.3，移动重定位 1.0 / 0.4）、rubberband 软边界、**glass 基础配方 background rgba(255,255,255,.6) + backdrop-filter blur(20px) saturate(180%) + 顶部亮线**、Materialize don’t just fade、不要在浅色半透明上叠半透明、避免 ≈0.2Hz 缓慢循环背景。
3. **同仓 review-animations/STANDARDS.md**：缓动令牌 `--ease-out: cubic-bezier(.23,1,.32,1)`、`--ease-in-out: cubic-bezier(.77,0,.175,1)`、`--ease-drawer: cubic-bezier(.32,.72,0,1)`；时长（按下 100–160ms、popover 125–200ms、**modal/drawer 200–500ms 且一律 <300ms**）；**永不用 scale(0)**，从 0.9–0.97 起步；CSS transition 可打断 / keyframes 会重启；只动 transform 与 opacity；不用父级 CSS 变量驱动子级 transform。
4. **Liquid Glass 实现**：`backdrop-filter: url(#filter)` **只有 Chromium 能绘制**（WebKit bug 245510）。可抄：purecss.com 的纯 CSS 版本（`@supports` 用 `-webkit-app-region` 探测 Chromium，其余引擎回落 blur）；`rdev/liquid-glass-react`（MIT）的 SVG filter 参数。

---

## 1. 目标 / 非目标 / 反目标

### 1.1 目标
1. 新增 **Glass 风格**（亮 + 暗两套），视觉对齐 macOS 26 / iOS 26：功能层玻璃 + 柔和彩光底 + 深柔阴影。
2. **暖纸风格一个字节不动**：`data-style` 缺省时，所有新规则都不命中。
3. 动效按 Apple 频率表落地：抽屉跟手拖拽（可打断、速度投影、rubber-band）、弹层 Materialize 入场、主题切换柔光过渡、AlertStack 滑入；**高频交互保持零动画或 120ms 以内**。
4. 三个无障碍信号全部实现：`prefers-reduced-motion`、`prefers-reduced-transparency`、`prefers-contrast`。
5. **零新增运行时依赖**（新增的都是自己的 css/ts 文件）。

### 1.2 非目标
1. 不改任何页面结构、不改 masonry 算法、不改邮件 Shadow DOM（`web/components/mail-reader/` 一行不动）、不改 Electron 主进程。
2. 不做滚动视差 / iOS 大标题收缩 / 页面切换过渡（URL 驱动、工具型面板，收益低于风险）。
3. 不做 Electron 窗口级材质（Windows 的 mica/acrylic 另议；macOS 的 vibrancy 也不在本轮）。
4. 不引入 framer-motion / motion / GSAP。

### 1.3 反目标
1. **禁止**把玻璃用在内容卡片上（HIG 明令）；禁止在便签/资产/邮件列表的卡片上用 `backdrop-filter`（列表滚动时会成倍放大 GPU 开销）。
2. **禁止**在 `[data-style]` 缺省时命中的规则（暖纸必须逐像素不变）。
3. **禁止**给 ⌘K 命令面板、键盘操作、列表 hover 加位移动画或 spring。
4. **禁止**把动画写进 `@keyframes` 后再做手势（keyframes 不可打断）。
5. **禁止**为了玻璃效果改动 `tools/pinboard.ps1`（UTF-8 BOM）与 `run-pinboard.vbs`（CRLF）这两个已知雷区文件。

---

## 2. 关键技术判断

### 2.1 为什么用「正交维度」而不是新增第 4 个 theme
现有 18 片 CSS 里有大量 `[data-theme="dark"]` 覆盖规则，且 `useShell.ts` 的 effect 每次只写 `dataset.theme = light | dark`。若把 Glass 做成 `data-theme="glass-light"` / `"glass-dark"`，全部暗色规则都会失效，等于重写样式层。

因此：**`data-theme` 继续只管亮/暗，新增 `data-style="paper | glass"`**。玻璃风格通过 `[data-style='glass'][data-theme='light']` 覆盖变量实现，暗色规则原样复用。回退 = 把 `data-style` 摘掉。

### 2.2 毛玻璃必须有东西可透
现在 `body` 是纯色 `--paper`，玻璃底下什么都没有，只会糊成一块灰。Glass 风格下 `body` 铺一层**静态** mesh 彩光（4 个 radial-gradient，`background-attachment: fixed`），不写动画（HIG 明确反对缓慢移动背景）。

### 2.3 真折射只可能出现在 Chromium，且只给小面积
- `backdrop-filter: url(#svgFilter)` 在 Safari/Firefox 是**解析但不绘制**，无报错、无回退，会直接变成「没有模糊」的半透明块——所以必须 `@supports` 探测，失败时回落纯 blur。
- 折射滤镜每帧都要跑一次位移贴图，**大面积**（侧栏 228×视口高、抽屉 580×视口高）风险高。因此：**侧栏与顶栏只用纯 blur**，折射只给命令面板 / 弹层 / 抽屉，并提供开关。

### 2.4 性能预算（验收时逐条核对）
| 项 | 预算 |
|---|---|
| 同屏 `backdrop-filter` 层数 | ≤ 3（侧栏 + 顶栏 + 至多一个浮层） |
| 列表卡片上的 `backdrop-filter` | **0** |
| 滚动 / 打字期间的长任务 | 无 > 50ms |
| 抽屉开合动画帧率 | ≥ 55fps |
| 首屏 CSS 增量 | < 12KB（未压缩） |

---

## 3. Glass 风格设计

### 3.1 维度与持久化

| 键 | 值 | 存哪 | 缺省 |
|---|---|---|---|
| `data-theme` | `light` / `dark`（由现有 theme=light/dark/system 解析） | `localStorage["pinboard-theme"]` | `system`（不变） |
| `data-style` | `paper` / `glass` | `localStorage["pinboard-style"]`（新增） | 见 §8 待定项 |
| `data-glass-refract` | `on` / `off` | `localStorage["pinboard-glass-refract"]`（新增） | `on`（非 Chromium 自动无效） |

设置 → 外观 从「主题 / 语言」两行变成「风格 / 明暗 / 语言」三行（折射开关只在 Chromium 下出现，作为风格行的次级 chip）。i18n 需要新增词条：`风格` `暖纸` `玻璃` `折射` `标准`，并同步写入 `shared/i18n/en/shell.ts`（该文件已有「外观/主题/浅色/深色/跟随系统」词条，紧挨着加）。

### 3.2 色彩令牌（亮色）

```css
[data-style='glass'][data-theme='light'] {
  /* 底色：冷中性，给玻璃一个可透的浅背景 */
  --paper: #eef1f7;
  --surface: rgba(255, 255, 255, 0.86);      /* 内容层：接近实底，不叠第二层半透明 */
  --surface-2: rgba(25, 33, 48, 0.05);
  --surface-3: rgba(25, 33, 48, 0.09);
  --ink: #101827;
  --ink-2: #3c4658;
  --muted: #6b7385;
  --line: rgba(16, 24, 40, 0.10);
  --line-strong: rgba(16, 24, 40, 0.16);
  --accent: #0a84ff;          /* Apple systemBlue */
  --accent-strong: #0069d9;
  --accent-soft: rgba(10, 132, 255, 0.12);
  --accent-ring: rgba(10, 132, 255, 0.22);
  --ok: #12874a;  --warn: #a86600;  --danger: #d92d20;
  --shadow-sm: 0 1px 2px rgba(16, 24, 40, 0.06);
  --shadow: 0 1px 2px rgba(16, 24, 40, 0.05), 0 14px 34px -22px rgba(16, 24, 40, 0.35);
  --shadow-lg: 0 30px 80px -34px rgba(16, 24, 40, 0.45);

  /* 玻璃：功能层专用，别给内容卡片用 */
  --glass-bg: rgba(255, 255, 255, 0.60);
  --glass-bg-strong: rgba(255, 255, 255, 0.72);
  --glass-blur: 24px;
  --glass-blur-strong: 32px;
  --glass-sat: 180%;
  --glass-border: rgba(255, 255, 255, 0.55);   /* 亮顶边 = 光落在材料上 */
  --glass-line: rgba(16, 24, 40, 0.08);        /* 玻璃内部的弱分隔 */
  --glass-shadow: 0 12px 32px -20px rgba(16, 24, 40, 0.32);
  --glass-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.60);
  --glass-tint: rgba(255, 255, 255, 0.55);     /* 按钮 / chip 这类「轻材料」 */
}
```

### 3.3 色彩令牌（暗色）

```css
[data-style='glass'][data-theme='dark'] {
  --paper: #0b0d12;
  --surface: rgba(30, 33, 41, 0.88);
  --surface-2: rgba(255, 255, 255, 0.07);
  --surface-3: rgba(255, 255, 255, 0.11);
  --ink: #f2f5fa;  --ink-2: #c4ccda;  --muted: #8b93a5;
  --line: rgba(255, 255, 255, 0.10);
  --line-strong: rgba(255, 255, 255, 0.18);
  --accent: #0a84ff;  --accent-strong: #4ba3ff;
  --accent-soft: rgba(10, 132, 255, 0.20);
  --accent-ring: rgba(10, 132, 255, 0.30);
  --ok: #34d399;  --warn: #fbbf24;  --danger: #ff6961;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.40);
  --shadow: 0 2px 6px rgba(0, 0, 0, 0.32), 0 18px 40px -24px rgba(0, 0, 0, 0.80);
  --shadow-lg: 0 34px 90px -36px rgba(0, 0, 0, 0.90);

  --glass-bg: rgba(22, 25, 32, 0.60);
  --glass-bg-strong: rgba(22, 25, 32, 0.72);
  --glass-blur: 24px;
  --glass-blur-strong: 32px;
  --glass-sat: 160%;
  --glass-border: rgba(255, 255, 255, 0.14);
  --glass-line: rgba(255, 255, 255, 0.08);
  --glass-shadow: 0 16px 40px -22px rgba(0, 0, 0, 0.75);
  --glass-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.10);
  --glass-tint: rgba(255, 255, 255, 0.10);
}
```

> 字号/字重/字距沿用 emilkowalski 的建议：玻璃上的文字用高对比、略重字重、微增字距（在玻璃层内对 `.topbar-title` `--ink` 与 `letter-spacing: .015em` 微调即可，不动全局字号）。

### 3.4 彩光底（静态 mesh，不是动画）

```css
[data-style='glass'] body {
  background-color: var(--paper);
  background-image:
    radial-gradient(42% 38% at 16% 8%,  rgba(10, 132, 255, 0.22), transparent 68%),
    radial-gradient(38% 34% at 86% 4%,  rgba(175, 82, 222, 0.18), transparent 68%),
    radial-gradient(46% 42% at 72% 92%, rgba(48, 176, 148, 0.16), transparent 70%),
    radial-gradient(36% 34% at 12% 84%, rgba(255, 149, 0, 0.14), transparent 70%);
  background-attachment: fixed;
  background-repeat: no-repeat;
}
/* 暗色：同一组色相，透明度略高（黑底上要更亮才透得出来） */
[data-style='glass'][data-theme='dark'] body {
  background-image:
    radial-gradient(42% 38% at 16% 8%,  rgba(10, 132, 255, 0.30), transparent 68%),
    radial-gradient(38% 34% at 86% 4%,  rgba(175, 82, 222, 0.24), transparent 68%),
    radial-gradient(46% 42% at 72% 92%, rgba(48, 176, 148, 0.20), transparent 70%),
    radial-gradient(36% 34% at 12% 84%, rgba(255, 149, 0, 0.16), transparent 70%);
}
```

### 3.5 玻璃层级映射表（严格按 HIG：只做功能层）

| 部件 | 材质 | 变体 | 具体值 |
|---|---|---|---|
| `.sidebar` | Liquid Glass | **regular**（文字多） | `--glass-bg-strong` + `blur(var(--glass-blur-strong)) saturate(180%)` + `border-right: 1px solid var(--glass-border)` + `--glass-highlight` 内高光 |
| `.topbar` | Liquid Glass | regular / 更薄 | `--glass-bg` + `blur(20px)`（现有 82% color-mix 与 blur(10px) 在 glass 下被覆盖，纸主题值不变） |
| `.drawer` | Liquid Glass | regular | `--glass-bg-strong` + `blur(30px) saturate(180%)` + 左边缘 `--glass-border` |
| `.modal-card` | Liquid Glass | regular | 同上 + `radius: 18px` + 遮罩 `.overlay` 加深 |
| `.palette`（⌘K） | Liquid Glass | regular | 同上，`radius: 16px` |
| `.overlay` | dim 遮罩 | — | `rgba(8,12,20,.28)` + `blur(4px)`（现有 blur(2px) 保留在纸主题） |
| `.btn` / `.chip` | **轻材料（不加 blur）** | — | `background: var(--glass-tint)`；小面积上跑 backdrop-filter 不值 |
| `.card` / `.asset-card` / `.svc-card` / 便签卡 | **标准材质（不许玻璃）** | — | `background: var(--surface)`（86% 白）+ `--glass-shadow`；无 backdrop-filter |
| 抽屉内的 `.card` | 标准材质 | — | 同上：**绝不在抽屉玻璃上再叠半透明卡片**（HIG 可读性红线） |

分隔线处理（emilkowalski）：玻璃层内部的 1px 实线统一降为 `--glass-line`（8% 透明）；`.content` 顶部与 `.topbar` 交界处加 8px 渐隐（伪元素 `linear-gradient`），代替硬线。

### 3.6 真折射（Liquid Glass displacement）

**能力探测**（不猜、不 feature-detect CSS 支持性写入）：
```css
/* 只有 Chromium 认 -webkit-app-region；Safari/FF 不认，于是整块跳过 */
@supports (-webkit-app-region: none) {
  [data-style='glass'][data-glass-refract='on'] .palette,
  [data-style='glass'][data-glass-refract='on'] .modal-card,
  [data-style='glass'][data-glass-refract='on'] .drawer {
    backdrop-filter: blur(18px) saturate(180%) url(#pb-glass-refract);
  }
}
```
- SVG filter 定义放 `web/components/GlassDefs.tsx`（渲染在 `App.tsx` 根部，`width=0 height=0 aria-hidden`，**不加进 DOM 流程**），结构 = `feImage`(径向渐变位移贴图) → `feGaussianBlur` → `feDisplacementMap`(R/B 通道)。
- **参数不自己调**：实现时先读 `rdev/liquid-glass-react`（MIT）源码，把它的 `feDisplacementMap/scale/stdDeviation/贴图渐变`原样搬过来；文件头写明出处与许可证，并在 `docs/` 致谢。
- `data-glass-refract=off` 或非 Chromium → 只有 `blur + saturate`（即标准毛玻璃），不会出现「没模糊」的裸块。

---

## 4. 动效系统设计

### 4.1 频率决策表（先看这张表，再决定要不要动）

| 交互 | 频率 | 结论 |
|---|---|---|
| ⌘K 命令面板开合 | 每天几十~上百次，键盘触发 | **零动画**（删掉 palette.css 的 `animation: pop .16s`；键盘动作本就不该有动画） |
| 侧栏导航切换 | 每天几十次 | 只保留 140ms 背景色过渡（现状 150ms，微调），**不加位移/缩放** |
| 列表项 hover | 高频 | 只 120ms 背景色；**不加位移动画**（列表滚动中位移=视觉噪音） |
| 便签卡 hover | 高频 | **只改阴影与描边**，不位移不缩放（masonry 绝对定位，位移会压到相邻卡） |
| 按钮按下 | 高频 | `scale(.97)` + 120ms（Apple 建议 100–160ms） |
| 抽屉开合（鼠标点/关闭键） | 偶发 | 260ms `--ease-drawer` 入场 + 退场 |
| 抽屉拖拽关闭 | 偶发 | **跟手 1:1 + 速度投影 + spring 0.8/0.3** |
| Modal / 观测详情弹层 | 偶发 | 240ms scale(.97)+opacity, Materialize |
| AlertStack 通知 | 偶发 | 滑入 220ms `--ease-out`，退场 160ms |
| 主题 / 风格切换 | 罕见 | 600ms 柔光交叉（View Transition API，不支持则瞬切） |
| 页面切换 | 每天几十次 | **不做**（工具型面板，URL 驱动） |

### 4.2 令牌（新增 `web/styles/motion.css`）

```css
:root {
  /* 缓动：来源 easings.co / Ionic（iOS 抽屉曲线），不自创 */
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
  /* 时长（UI 一律 < 300ms；主题切换属罕见操作，单独给长值） */
  --dur-press: 120ms;
  --dur-hover: 140ms;
  --dur-pop: 180ms;
  --dur-overlay: 260ms;
  --dur-theme: 600ms;
  /* spring 只给 JS 用，这里只留注释性变量，CSS 里不消费 */
}

@media (prefers-reduced-motion: reduce) {
  /* 全局兜底：所有过渡 / 动画退化成极短的透明度交叉 */
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}
```

> 注意：`prefers-reduced-motion` **不由 CSS 单独完成**——跟手拖拽必须由 JS 判断（`matchMedia`）后关闭位移，只保留「松手即关」。

### 4.3 spring 的实现（`web/lib/motion.ts`，纯函数 + 无依赖）

Apple 的 damping ratio / response 与弹簧物理量的换算用业界通用式（Framer/Apple 表都用它，不自创）：

```ts
// stiffness = (2π / response)^2 ; damping = 4π·ζ / response
export function springParams(zeta: number, responseSec: number) {
  const stiffness = (2 * Math.PI / responseSec) ** 2;
  const damping = 4 * Math.PI * zeta / responseSec;
  return { stiffness, damping };
}
// Apple 出货值
export const SPRING_DRAWER = { zeta: 0.8, response: 0.3 }; // 抽屉 / sheet
export const SPRING_MOVE = { zeta: 1.0, response: 0.4 };   // 移动 / 重定位（无过冲）

// 动量投影（Apple 原式，不是 v²/2a）
export function project(velocity: number, decel = 0.998) {
  // Apple 原式写作 (v / 1000) * decel / (1 - decel)，那个 /1000 是因为 UIScrollView 的
  // velocity 单位是 pt/s。本项目的 v 一律用 px/ms（与 FLICK_VELOCITY=0.11 同单位），
  // 故去掉 /1000：v=1 px/ms 时投影 ≈ 499px，与"每毫秒衰减 0.2%（decel .998）"的
  // 几何级数 Σ v·dt·decel^n 一致。（2026-11-09 修正：原稿单位自相矛盾，见 ledger R7）
  return velocity * decel / (1 - decel);
}

// rubber-band 软边界
export function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

// 速度阈值：Abs(distance)/elapsedMs > 0.11 即视为「甩出去」
export const FLICK_VELOCITY = 0.11;

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// 用 rAF 积分的弹簧；返回 cancel。onFrame 每帧收到当前值。
export function spring(opts: {
  from: number; to: number; velocity?: number;
  zeta: number; response: number; onFrame: (v: number) => void; onDone?: () => void;
}): () => void
```

实现要点（照 emilkowalski）：
1. **永远从当前屏幕值起动画**，不要从 0 或目标值起（被打断时这是唯一正确的起点）。
2. 松手时把 `relativeVelocity = gestureVelocity / (target - current)` 作为弹簧初速（速度交接），否则拖到一半松手会「顿一下」。
3. 2D 运动拆成两个独立 spring（X / Y 各自算），合成会失真。
4. 动画进行中再次 pointerdown → **立即取消当前 spring，接管为拖拽**。

### 4.4 抽屉跟手拖拽规格

**状态机**：`idle → dragging → settling(open) | settling(closed) → idle`

| 阶段 | 行为 |
|---|---|
| `pointerdown`（落点在 `.drawer-head` 或移动端的 `.drawer-grab` 手势条） | `setPointerCapture`；记录 `startX/startY`、`lastMoves`（最近 5 条 `{t,x}`）；`data-dragging="true"`（此属性下关掉 CSS transition） |
| `pointermove` | `dx = max(0, x - startX)`（只允许向右关）；`translateX(rubberband(dx, width))`；遮罩透明度 `1 - progress*0.9`；**直接写 `el.style.transform`，不用 CSS 变量驱动子元素** |
| `pointerup` | 取最近 100ms 平均速度 `v`（px/ms）；`projected = dx + project(v)`（`project` 已与 v 同单位，1 px/ms ≈ 499px 投影）；`closing = projected > width * 0.5 或 v > 0.11` |
| `settling` | `spring({from: currentX, to: closing ? width : 0, velocity: v, zeta: .8, response: .3})`；到 `width` 后调用 `onClose()` 并还原 transform |
| `Escape` / 点遮罩 / 点关闭按钮 | **不经过 spring**，直接走 CSS 260ms `--ease-drawer` 退场（属于「用户决定」，走确定性时序） |
| 拖动中 | 屏蔽抽屉内部 `text-selection`（`user-select: none`）；`pointercancel` 按 `pointerup` 处理 |

**为什么必须在 `.drawer-head` 上抓**：抽屉主体是可滚动的表单（资产抽屉、观测抽屉），整块可拖会与 `input`/`textarea` 的文本选择打架。头部本来就不可交互，是最安全的抓取面。移动端再补一条顶部 24px 的 `.drawer-grab` 细条（视觉两根小圆角线，符合 iOS sheet 语言）。

### 4.5 入场 / 退场：从 keyframes 迁到 transition + presence
现状 `.overlay / .drawer / .modal-card / .palette` 都用 `animation: fade/slide/pop`，且 `open === false` 时**直接 return null**——没有退场，也无法打断。

改造：
1. **入场**：`@starting-style`（Chromium 支持；Electron 与 Chrome/Edge 都行，其余浏览器退化为无入场动画，可接受）。
2. **退场**：`ui.tsx` 的 `Drawer`/`Modal` 内部加 `usePresence` —— `closing` 期间保持挂载 260ms 并冻结 **最后一次的 children 快照**（用 ref 保存），避免父组件 `setSelectedId(null)` 把内容清空导致抽屉里先闪白。
3. **Materialize**（玻璃专属）：入场同时把 `background-color` 的 alpha 从 `0` 过渡到 `var(--glass-bg-strong)`，并让 `blur` 从 `6px` 涨到 `30px`（`backdrop-filter` 可过渡，但成本高，只在入场那 260ms 内做）。
4. `prefers-reduced-motion` 下：入场退场只剩 `opacity` 交叉，无位移无缩放。

### 4.6 主题 / 风格切换的柔光过渡

```ts
// useShell.ts 里包一层：支持就用 View Transition，不支持就直接改（Chromium 均有）
function applyThemeWithTransition(mutate: () => void) {
  const doc = document as any;
  if (prefersReducedMotion() || typeof doc.startViewTransition !== 'function') { mutate(); return }
  doc.startViewTransition(mutate);
}
```
配合 CSS：`::view-transition-old(root) { animation: fade-out var(--dur-theme) }` / `::view-transition-new(root) { animation: fade-in var(--dur-theme) }`。**不做圆形扩散**（`:root` 圆扩散要手动算坐标，收益不抵复杂度）。

### 4.7 无障碍降级（三个信号全实现）

| 信号 | 行为 |
|---|---|
| `prefers-reduced-motion: reduce` | 全部动画→1ms 透明度交叉；抽屉拖拽位移禁用（松手即关）；主题切换瞬切 |
| `prefers-reduced-transparency: reduce` | `backdrop-filter: none`；玻璃背景 alpha → `.96`；加回 1px 实边（≈ 退回暖纸的实心观感） |
| `prefers-contrast: more` | `--glass-border` → `1px solid var(--ink)`；`--glass-line` → `var(--line-strong)`；文字不再依赖玻璃透明度 |

```css
@media (prefers-reduced-transparency: reduce) {
  [data-style='glass'] .sidebar, [data-style='glass'] .topbar,
  [data-style='glass'] .drawer, [data-style='glass'] .modal-card,
  [data-style='glass'] .palette { backdrop-filter: none !important; background: var(--surface); }
}
```

---

## 5. 文件改动清单

### 5.1 新增

| 文件 | 作用 |
|---|---|
| `web/styles/motion.css` | 动效令牌 + reduced-motion 兜底（只放令牌与全局降级，不放组件规则） |
| `web/styles/glass.css` | 玻璃令牌（亮/暗）+ 彩光底 + 功能层玻璃化 + 内容层材质 + 无障碍降级。**必须排在 index.css 最后**，它要覆盖 shell/overlay/palette |
| `web/lib/motion.ts` | `spring` / `springParams` / `project` / `rubberband` / `FLICK_VELOCITY` / `prefersReducedMotion`（纯函数，可单测） |
| `web/lib/motion.test.mts`（放 `tests/unit/motion.test.mts`） | 弹簧收敛、投影公式、rubberband 边界、速度阈值 —— 纯数值断言，跟着现有 740 条一起跑 |
| `web/components/GlassDefs.tsx` | 折射 SVG filter 定义（参数抄 liquid-glass-react，MIT，文件头署名） |

### 5.2 修改

| 文件 | 改什么 | 风险 |
|---|---|---|
| `web/styles/index.css` | 第 2 行插 `./motion.css`，末尾插 `./glass.css` | 低（顺序即层叠，注释已提醒） |
| `web/styles/shell.css` | `.topbar` 的 `color-mix(82%) + blur(10px)` 改成消费令牌 `--glass-bg` / `--glass-blur`，纸主题下令牌值 = 现值（逐像素不变）；`.sidebar` 背景改 `var(--surface)` 不变，只把 `border-right` 换成 `--glass-line` 令牌（纸主题=现值） | 中：必须核对纸主题无像素差 |
| `web/styles/overlay.css` | `animation: fade/slide/pop` → `transition` + `@starting-style`；`.drawer-head/.drawer-foot` 的实线换 `--glass-line` | 中：退场依赖 `usePresence` |
| `web/styles/palette.css` | **删掉** `animation: pop 0.16s ease-out`（⌘K 无动画） | 低 |
| `web/styles/controls.css` | `.btn:active { transform: translateY(1px) }` → `scale(.97)` + `--dur-press`；glass 下 `.btn/.chip` 用 `--glass-tint` | 低 |
| `web/app/useShell.ts` | 新增 `style` 状态 + `STYLE_KEY` + 写 `dataset.style`；新增 `refract` 状态 + `dataset.glassRefract`；主题/风格写入包 View Transition | 低 |
| `web/pages/settings/AppearanceCard.tsx` | 新增「风格」行（暖纸 / 玻璃），Chromium 下追加「折射」chip | 低 |
| `web/pages/SettingsPage.tsx` | 透传 `style/setStyle/refract/setRefract` | 低 |
| `web/App.tsx` | 渲染 `<GlassDefs />`；透传新 props | 低 |
| `web/components/ui.tsx` | `Drawer` 接 `usePresence` + 拖拽（`.drawer-head` 抓手、pointer capture、spring 收尾）；`Modal` 接 presence | **中高**：三个抽屉（资产/观测/邮件账号）都走它，必须逐个手测 |
| `web/main.tsx` | `createRoot` 之前先跑一次 `applyStoredTheme()`（把 `data-theme`/`data-style` 在首帧前写好，消除切风格时的闪白） | 低 |
| `shared/i18n/en/shell.ts` | 新增词条：`风格` `暖纸` `玻璃` `折射` `标准`（紧挨现有「外观/主题/浅色/深色/跟随系统」） | 低（有单测查占位符与残留中文） |

> 不动的文件（明确写出来，避免实现时手痒）：`web/lib/masonry.ts`、`web/pages/notes/useMasonry.ts`、`web/components/mail-reader/**`、`desktop/**`、`server/**`、`tools/pinboard.ps1`、`run-pinboard.vbs`。

> 另外：**任何常量里新加的中文原文，都要在 `shared/i18n/en/shell.ts` 同步一条英文**，否则 `tests/unit/i18n-core.test.mts` 的「英文条目里还有中文」那条会挂（它扫的是 en 字典，缺条目不会挂，但英文界面会露出中文——按项目惯例要补）。

---

## 6. 风险与防护

| 风险 | 后果 | 防护 |
|---|---|---|
| 暖纸主题被新规则误伤 | 用户可见的视觉回归 | 所有新规则都挂在 `[data-style='glass']` 前缀；验收时对纸主题跑一遍**逐页截图对比**（改前改后各截一份） |
| 玻璃层过多导致滚动掉帧 | 日常卡顿（最要命） | 预算表 §2.4；列表卡片 0 个 backdrop-filter；每加一层都要录一次 Performance |
| 抽屉拖拽抢走表单文本选择 | 抽屉里选不中文字 | 只在 `.drawer-head` / 移动端 `.drawer-grab` 上抓；不在 `.drawer-body` 上监听 |
| `usePresence` 冻结 children 时内容错位 | 关闭瞬间闪白/闪空 | 用 ref 保最后一份 children 快照；三个抽屉逐个测「点关闭→内容是否闪」 |
| 折射滤镜在旧 Chromium 上不渲染 | 抽屉变「没模糊的透明块」 | `@supports (-webkit-app-region: none)` 内才启用；关掉折射开关时完全回落 `blur+saturate` |
| masonry 便签页被 transform 影响 | 卡片重叠 / 布局抖动 | 便签卡只改阴影与描边，**不加 transform** |
| Electron 打包后 CSS 丢失 | 桌面端白屏 | `pnpm build:web` 产物进 `dist/web`，验收必须跑一次桌面端（`dist-desktop`） |
| 改完忘记 build | 浏览器看还是旧样式 | 改完必跑 `pnpm build:web`（坑：server 直接读 dist/web） |

---

## 7. 验收标准

### 7.1 必过（阻塞）
1. `pnpm typecheck` 通过；`pnpm test`（740+ 新增 motion 单测）全绿；`pnpm test:e2e` 通过。
2. `pnpm build:web` 成功，起 7788 后 **8 页 × 4 组合**（纸亮/纸暗/玻璃亮/玻璃暗）手测无布局错、无文字不可读。
3. **纸主题零回归**：改前 baseline 截图与改后逐页比对，肉眼无差异。
4. 抽屉：鼠标快速甩出关闭 / 慢慢拖过一半关闭 / 拖回原位复位 / 拖到一半反向 / 拖到一半松手再抓 —— 五种都顺，不回弹错误方向。
5. `prefers-reduced-motion` / `prefers-reduced-transparency` / `prefers-contrast` 三个模拟下（DevTools Rendering 面板）表现符合 §4.7。
6. Performance：滚动便签页 + 资产列表 10s、打开/关闭抽屉 5 次，**无 > 50ms 长任务**，动画帧率 ≥ 55fps。
7. Electron 桌面端起得来、玻璃生效、抽屉可拖。

### 7.2 建议（不阻塞）
- ⌘K 打开耗时 < 50ms（现在有 animation，去掉后应更快）。
- Safari / Firefox 上玻璃退化为「半透明+模糊」，不出现裸透明块（用 `blur()` 兜底验证）。

---

## 8. 分阶段实施（每阶段可独立验收、可独立回退）

| 阶段 | 内容 | 完成标志 |
|---|---|---|
| **P1 令牌 + 玻璃外壳** | `motion.css`、`glass.css`、index.css 顺序、`useShell` 的 `data-style`、AppearanceCard 风格行、i18n；先不动任何 JS 动效 | 切到玻璃风格，侧栏/顶栏/抽屉/弹层/命令面板是玻璃，内容卡片是标准材质；纸主题像素不变 |
| **P2 动效** | `motion.ts`（含单测）、`ui.tsx` 的 presence + 抽屉拖拽、overlay/palette/controls 的 transition 化、主题柔光过渡 | §7.1 第 4、5、6 条通过 |
| **P3 真折射** | `GlassDefs.tsx` + `@supports` + 开关；参数从 liquid-glass-react 搬 | Chromium 上抽屉/弹层有边缘折射；关掉开关或换 Firefox 时观感与 P1 完全一致 |

每阶段结束跑一次 §7.1 的第 1、3 条（类型/单测/纸主题零回归），不等全部做完再测。

---

## 9. 待确认（需要用户点头）

1. **默认风格**：新访客/清空 localStorage 后默认进 `glass`（你要的就是升级后的观感）还是 `paper`（零意外）？**推荐 glass**，纸主题仍是一键可回。
2. **折射开关默认值**：默认开（Chromium 才真的看得见）还是默认关（用户自己去开）？**推荐开**。
3. **⌘K 无动画**（§4.1 第 1 行）：确认按 Apple 频率表执行，删掉现在的 `animation: pop`。
4. 玻璃下主色从暖橙 `#b4530a` 换成 Apple systemBlue `#0a84ff`：**刻意为之**（暖橙压在冷玻璃上显脏）。如果你希望玻璃也保留橙色强调，我改成暖色玻璃（改一行令牌）。

---

## 10. 实施记录（2026-11-09，落地后的偏差与实测结论）

本节是**唯一权威的实施现状**：上面 §0–§9 是设计时写的，凡与本节点冲突，以本节点为准。

### 10.1 已落地

| 阶段 | 状态 | 提交 |
|---|---|---|
| P1 令牌 + 玻璃外壳 | 已完成 | `2192207` / `f476a82`（+ 修 `5ce3f6c` 恢复 hover、压层级预算） |
| P2 动效 | 已完成 | `db35e0c`（motion.ts）+ `ace7ea5`（投影单位修正）+ `cd12a9d`（偏好同步修正）+ `28908f9`（presence + 跟手拖拽 + transition 化） |
| P3 真折射 | **代码已落地、默认关闭** | `7e5f194`（见 10.3） |

### 10.2 两处顺带修掉的生产缺陷（都是「设计没错、构建/取值错了」）

1. **lightningcss 吃掉无前缀声明**：Vite 8 的 CSS 压缩器把 `backdrop-filter` 与 `-webkit-backdrop-filter` 认成同一属性，只保留**后出现**的那条。原来「无前缀在前」→ 产物里无前缀声明被删，Chrome 不认 `-webkit-`，玻璃层 computed 是 `none` = 线上等于没模糊。已把 10 处成对声明改成 `-webkit-` 在前、无前缀在后（`glass.css` 文件头有 ⚠️ 说明）。**重建产物后复查：每条规则两行都在。**
2. **投影单位重复换算**：`project()` 原先把 `pt/s → px/ms` 再除一次 1000，速度被缩小 1000 倍，松手判据形同虚设。改成 `v * decel / (1 - decel)`，`project(1)`（1px/ms）≈ 499px。

### 10.3 折射：实现保留，默认 `off`（唯一实质降级）

真实 Chrome 156 + 真实组件实测（证据见 `tmp/sdd/glass-style-and-motion/reports/t5.md` §4）：

- 同一条滤镜走 `filter: url(#refr)` 时位移是正常透镜斜坡（−2.0 / +6.5 / +11.0 px，随位置变号）；
- 走 `backdrop-filter: url(#refr)` 时 **feImage 的结果喂不进 feDisplacementMap**（R=B=0），整块背景被恒定平移 ≈12.5px（= scale/2）。换成 `feFlood` 常量场就正常，换 PNG / 任意尺寸贴图都一样 → 是 Chromium 这条链路的问题，不是贴图或夹具问题。

因此 `theme-prefs.ts` 的 `DEFAULT_REFRACT` 定为 `'off'`：开关和 `GlassDefs` 全部保留，等 Chromium 修好或用 Electron 确认后改一行即可启用；关闭时完全回落 P1 的纯 blur，观感正常。设置页开启时用一行小字如实说明现状。

### 10.4 与正文的其他偏差

1. **折射覆盖面取五个功能层**（.sidebar / .topbar / .drawer / .modal-card / .palette），比 §2.3 / §3.6 的三层多两个；理由：Apple 的侧栏本身就是折射材质，且折射开启时 blur 统一降到 18px（滤镜链比 30px 强模糊更短）。要回到三层，删折射块与降级块里 sidebar/topbar 四行选择器即可。
2. **presence 时长**：抽屉 260ms（= `--dur-overlay`）、弹窗 240ms；关闭期间元素挂 `data-state="closing"` 留在 DOM，`ui.tsx` 冻结最后一次 open 的 title/children/footer，避免关闭瞬间先闪白。
3. **抽屉退场用 `translateX(100%)`**（与拖拽关到底同终点），入场用 `@starting-style`（从 +24px / opacity .4 起）。只在 `.drawer-head`（及可选 `.drawer-grab`）抓拖拽，正文不抓，按钮/输入框不拦。
4. **`fade` / `slide` 两条 keyframes 已删**，`pop` 保留（`misc.css` 的 toast 还在用）。

### 10.5 仍然未验证 / 未做

- Electron 桌面端（`dist-desktop`）未跑视觉验证。
- 滚动 / 开合帧率未录 Performance 面板；层级预算（≤3 层 backdrop-filter）靠静态核对。
- `web/App.tsx` 的 render 里直接读 `dataset.theme`（历史写法）未整顿。
