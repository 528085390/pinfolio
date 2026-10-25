# 发版（维护者手册）

发布流程是手动的，只有镜像构建与 GitHub Release 是自动的。**发版前请把下面的清单走完**，
尤其是「全量测试」和「CHANGELOG 段落」——release workflow 会从 CHANGELOG 里抽正文，抽不到就红。

## 版本号

语义化版本，1.0.0 之前都是 `0.x`：

- 加功能 / 改结构 → 次版本号 +1（`0.2.0` → `0.3.0`）
- 只修 bug → 修订号 +1（`0.2.0` → `0.2.1`）
- 破坏性变更（迁移不兼容、环境变量改名）→ 次版本号 +1，并在 CHANGELOG 里写明怎么迁移

**1.0.0 的门槛**（三条都满足才配 1.0）：

1. 鉴权 + 部署 + 备份三块齐全且经过真机验证；
2. 文档齐全：`deploy.md`、`upgrade.md`、`backup-restore.md`、`faq.md`、API 文档；
3. `docker compose up -d` 在干净机器上一把通（含 Caddy TLS profile）。

## 清单

1. **改版本号**：`package.json` 的 `version`。
2. **写 CHANGELOG**：`CHANGELOG.md` 顶部加 `## [x.y.z] - YYYY-MM-DD`，下面按模块分段
   （便签 / 资产 / 观测 / 邮件 / 主机 / 备份 / 部署 / 安全 / 工程化）。这一段会成为 Release 正文。
3. **全量测试**：

   ```bash
   pnpm test                                  # typecheck + 单测 + 片段
   PINBOARD_PASSWORD=<本机密码> node tests/run.mjs    # 15 套 e2e（需要本机 Kuma 与邮箱配置）
   ```

4. **构建一次**：`pnpm build`，确认 `dist/server.js` 与 `dist/web/` 都出来了。
5. **提交并打 tag**：

   ```bash
   git add -A && git commit -m "发布：v0.2.0"
   git tag -a v0.2.0 -m "v0.2.0"
   git push origin master --follow-tags
   ```

   tag 必须是 `v*.*.*`，否则 `.github/workflows/release.yml` 不触发。

## 自动化做了什么

`.github/workflows/release.yml` 在 tag 推上去之后：

1. 用 buildx + QEMU 构建 `linux/amd64` + `linux/arm64`，推 `ghcr.io/528085390/pinfolio:v0.2.0` 与 `:latest`；
2. 用 `tools/release-notes.mjs` 从 CHANGELOG 抽本版本段落，建一个 GitHub Release
   （tag 名里带 `-` 的，例如 `v0.3.0-rc1`，自动标成 prerelease）。

## 发版后检查

1. Actions 两个 job 都绿；`ghcr.io/528085390/pinfolio` 的 tag 列表里新版本与 `latest` 都在，
   且 manifest 里有 `amd64` 与 `arm64` 两个平台（`docker buildx imagetools inspect <image>:v0.2.0`）。
2. GitHub Release 的正文不是空的（空的话说明 CHANGELOG 里那段标题格式不对）。
3. 找一台干净机器（或删掉本地卷）跑一次真升级：

   ```bash
   docker compose pull && docker compose up -d
   curl -s http://127.0.0.1:7788/api/health
   ```

4. 更新仓库 About / topics 里过时的描述（如果这版改了定位）。

## 出错怎么办

- **不要删 tag 重打同一个版本号**：镜像缓存、用户本地 tag 都会对不上。有问题就发 `x.y.z+1`。
- tag 推错了（例如少提交一个文件）：删 tag（`git tag -d v0.2.0 && git push origin :refs/tags/v0.2.0`），
  修好后重新打——只要还没人 `pull` 过，这样做是安全的。
- 镜像构建失败但代码没问题：重跑 workflow（`gh workflow run release.yml` 不行，release 只由 tag 触发；
  删 tag 重推即可）。
