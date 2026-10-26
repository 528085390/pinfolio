# 07 · 开源工程化（CI / 发布 / 文档 / 社区）

- 状态：**已实施**（2026-10-26，分支 arch；实施记录见文末）
- 依赖：02–06（功能齐了才有意义）

## 前置：`package.json` 补齐

```json
"packageManager": "pnpm@12.3.4",
"engines": { "node": ">=24" }
```

CI 与镜像都依赖这两个字段。

## CI（`.github/workflows/ci.yml`）

- 触发：push 到 `main`、所有 PR；`concurrency` 取消同分支旧 run。
- 步骤：checkout → `pnpm/action-setup`（版本取 `packageManager`）→ `setup-node` 24 + pnpm 缓存 → `pnpm install --frozen-lockfile` → `pnpm typecheck` → 单测 + 片段 → `pnpm build`。
- e2e 分两档：CI 只跑「无外部依赖」子集（notes / assets / settings / 观测页空态），需要给 `tests/run.mjs` 加分组参数；依赖真实 Kuma / 邮箱 / 采集端的三套只在本地跑，README 写明。
- 超时 10 分钟；失败即红，不设 `continue-on-error`。

## 发布（`.github/workflows/release.yml`）

- 触发：push tag `v*.*.*`。
- `docker/build-push-action` + buildx + QEMU 构建 `linux/amd64`、`linux/arm64`，推 `ghcr.io/<owner>/pinfolio`：版本 tag + `latest`；登录用 `GITHUB_TOKEN`（`packages: write`）。
- 同 workflow 从 `CHANGELOG.md` 抽本版本段落建 GitHub Release（不用自动生成 notes）。
- 人工 checklist（`docs/release.md`）：改版本号 → 写 CHANGELOG → 本地 `docker compose up` 冒烟 → 打 tag。

## 文档结构

README 只留「是什么 / 30 秒跑起来 / 截图 / 配置表 / 备份恢复 / 链接」，其余进 `docs/`：

| 文件 | 内容 |
|---|---|
| `docs/deploy.md` | Docker + Caddy、裸机、反代、环境变量全表 |
| `docs/backup-restore.md` | 自动备份机制、手动备份、灾难恢复 |
| `docs/upgrade.md` | 升级步骤、迁移失败怎么办 |
| `docs/faq.md` | 没配 Kuma 怎么办、邮件连不上、端口冲突、数据在哪 |
| `docs/architecture.md` / `docs/api.md` / `docs/adding-assets.md` | 已有，补英文摘要 |

README 顶部：一句话定位 + 三张截图（桌面 / 手机 / 观测页）+ badge（CI、License、镜像）。正文中文，顶部给一段英文摘要。

**同时修掉两处过时内容**：`README.md:3` 的 MIT badge 改 AGPL-3.0；`README.md:9` 的 "no accounts, no cloud, no Docker" 删除（鉴权与 Docker 都有了）。

## 社区文件

| 文件 | 要点 |
|---|---|
| `LICENSE` | **AGPL-3.0** 全文 |
| `CONTRIBUTING.md` | 本地开发（`pnpm dev`）、改后端必须补单测、改 UI 附截图、提交信息沿用「模块：做了什么」 |
| `CODE_OF_CONDUCT.md` | Contributor Covenant 2.1 官方文本 |
| `SECURITY.md` | 走私密渠道（GitHub Security Advisories），写支持版本范围 |
| `.github/ISSUE_TEMPLATE/bug_report.yml` / `feature_request.yml` | YAML 表单：版本、部署方式、日志、复现步骤 |
| `.github/pull_request_template.md` | 改了什么 / 为什么 / 怎么验的 |
| `.github/dependabot.yml` | npm 每周、actions 每月；dev / prod 分组；`typescript`、`vite` 大版本忽略 |

## 版本与分支

- SemVer；**1.0.0 门槛**：鉴权 + 部署 + 备份三件齐全、文档齐、`docker compose up` 一把跑通；之前都是 0.x，破坏性改动升 minor。
- `main` 直推（单人维护），PR 走 CI；等有外部贡献者再开分支保护。
- CHANGELOG：Keep a Changelog 格式，中文条目，按「新增 / 修复 / 变更」分组。

## 仓库设置（一次性人工）

Description、Topics（已配好）、About 挂截图、Discussions 先不开、Social preview 图需网页上传。

## 验收

- PR 上 CI 绿（typecheck + 单测 + build + e2e 子集）。
- 打一个 `v0.x` tag，出双架构镜像，`docker pull` 后能跑。
- 一台干净机器按 README 30 分钟内跑起来。

## 不做

- 覆盖率门槛、nightly 构建、自动合并 Dependabot、VitePress 文档站。

## 实施记录（2026-10-26）

与上面设计的偏差，逐条记下来：

1. **CI 触发的分支是 `master` / `arch` / `dev`**，不是 `main` —— 2026-10-23 起 `main` 已改名 `master`（远程 `main` 删除），`dev` 是日常开发、`arch` 是架构升级工作树。
2. **三个 job 而不是一个**：`test`（timeout 10：`pnpm test` + `pnpm build`）、`e2e`（timeout 15：装 chromium + `node tests/run.mjs --only=ci`）、
   `docker`（timeout 20：buildx 真构建一次镜像但不推）。多加 `docker` 是因为镜像在本机从来没 build 过（本机与服务器都没有 docker），
   让它在 PR 上就能暴露 Dockerfile 的问题。
3. **`--only=ci` 的组成是「core 全套 + monitor-empty」**，不是当初设想的「notes / assets / settings / 观测页空态」子集：core 本来就是零外部依赖
   （`run.mjs` 自己起隔离实例），真正需要 Kuma 的只有 `monitor` 组。新写的 `tests/e2e-monitor-empty.mjs` 自起一个 `KUMA_SLUG` 不存在的实例，
   把「没接 Kuma → 引导卡」这条以前没人测的路径固化了。
4. **`tests/e2e-router.mjs` 的判定顺手修了**：原来用「页面上有 `.stat-label` 的『观测项』」判断观测页加载完成，没数据时永远为假；改成 `.page-monitors`，
   对数据不再有依赖 —— 这是 CI 能跑 core 的前提。
5. **README 是英/中两版同构**（`README.md` + `README.zh.md`），不是「正文中文 + 顶部英文摘要」：两版的章节一一对应，badge 都是 5 个
   （CI / AGPL-3.0 / Node ≥24 / 390 单测 / ghcr 镜像）。
6. **许可证定为 AGPL-3.0-or-later**（`package.json` 的 SPDX 写法），`LICENSE` 是 AGPL-3.0 全文；版本号同步从 `0.1.0` 升到 `0.2.0`，
   CHANGELOG 的 `## [未发布]` 落成 `## [0.2.0] - 2026-10-26`。
7. **发布脚本拆成 `tools/release-notes.mjs`**：`extractSection(text, tag)` 是纯函数（可单测），workflow 里只负责把它接到 `action-gh-release`。
   tag 名含 `-` 时自动标 prerelease。

**验收状态**（2026-10-26 补齐）：CI 的三个 job 已在 GitHub 上真跑过并全绿——`master` 与 `dev` 在同一个提交
`3352880` 上 `test` / `e2e` / `docker` 三件套都是 success（`docker` job 是镜像的第一次真实构建）。
两个 tag 都走完了 `release.yml`：`v0.2.0`、`v0.3.0`，Release 正文由 `tools/release-notes.mjs` 从 CHANGELOG 抽出，
`ghcr.io/528085390/pinfolio` 的 `v0.3.0` 与 `latest` 都是 `linux/amd64` + `linux/arm64` 双架构。
`docker compose up` 一把通已在真机验过（见 [04](04-deploy.md) 的验收状态）。

1.0.0 门槛（鉴权 + 部署 + 备份齐全、文档齐、`docker compose up` 一把通）**四条现在都达成**，
版本号停在 0.3.0 只是发版节奏的选择，不是能力缺口。

