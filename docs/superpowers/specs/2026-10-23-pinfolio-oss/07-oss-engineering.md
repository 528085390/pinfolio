# 07 · 开源工程化（CI / 发布 / 文档 / 社区）

- 状态：待实施（最后一块）
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
