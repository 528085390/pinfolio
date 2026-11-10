# 实施计划：便签附件扩容（任意文件 / 100 MB / 对象存储）

> 规格：`docs/superpowers/specs/2026-11-10-note-file-attachments.md`
> 执行方式：本会话内联实现（TDD：先写失败的测试，再实现）。
> 每个任务都要「改完能自证」：跑对应的单测或 e2e，贴输出。

## 任务 1：SigV4 签名（纯函数 + 官方向量）

- 新增 `server/storage/sigv4.ts`：`sha256Hex` / `hmacSha256` / `signingKey` / `canonicalQuery` / `signRequest`。
- 新增 `tests/unit/sigv4.test.mts`：AWS 官方 `get-vanilla`、`get-vanilla-query-order-key-case` 两个测试向量,
  外加本仓库固定输入（PUT 对象、带 x-amz-content-sha256）的签名快照。
- 验收：`node --import tsx --test tests/unit/sigv4.test.mts` 通过；同一输入签名稳定（可重放）。

## 任务 2：存储配置 + S3 客户端

- 新增 `server/storage/config.ts`：`readStorageConfig(env)`，四项齐备才是 `s3`。
- 新增 `server/storage/s3.ts`：`putObject` / `getObject` / `headObject` / `deleteObject`，undici + 任务 1 的签名，
  支持 `Range`、超时、错误带上 S3 的 `<Code>`。
- 新增 `tests/unit/storage-config.test.mts`（环境变量解析 / 缺项回落 local / 前缀归一）。
- 验收：单测绿；用真实 OCI 桶跑一次 `put→head→get→delete` 冒烟（手工，脚本留在 `tmp/`）。

## 任务 3：附件纯逻辑扩容（kind / mime / ext / inline 白名单 / 体积）

- 改 `server/attachments/core.ts`：`MAX_UPLOAD_BYTES = 100 MB`、`sniffKind`（魔数）、`extForMime`、
  `isInlineSafe`、`fileMarkdown`、`attachmentsAsText`（快照）；保留 `sniffImage` 兼容。
- 新增 `tests/unit/attachments-kind.test.mts`：每种魔数、未知类型回落 `file`、svg/html 不在 inline 白名单、
  100 MB 边界、`extForMime` 未知回落 `bin`。
- 验收：单测绿；原有 `attachments-core.test.mts` 不改也绿（向后兼容）。

## 任务 4：迁移 v5 + 存储落盘分支

- 改 `server/schema/attachments.ts`（新列进建表语句）+ `server/migrations.ts`（v5 补列，幂等）。
- 改 `server/attachments/store.ts`：`saveAttachment` / `deleteAttachmentsForNote` / `sweepAttachments` 变 async，
  按 `storage` 分支（本地写文件 / S3 putObject），新增 `storageUsage()`、`readAttachmentStream(row, range)`。
- 扩 `tests/unit/attachments-store.test.mts`：s3 分支（注入假客户端）、配额计算、清扫删对象。
- 验收：`faketime` 不动；单测绿；老库（user_version=4）迁移到 5 后旧图片行 `kind='image', storage='local'`。

## 任务 5：路由（上传 / 取文件 / Range / CSRF）

- 改 `server/routes/attachments.ts`：自定义头校验、100 MB、配额、按 kind 存；GET 流式 + Range + 白名单 inline。
- 改 `server/auth/middleware.ts`：放行条件从 `content-type: image/*` 换成 `x-pinfolio-upload: 1` 且 content-type 不是表单三类。
- 新增 `tests/unit/attachments-route.test.mts`（用 Hono `app.request` 打路由，假存储）。
- 验收：单测绿；`curl` 手工验证 413 / 415 / 401 三条错误码。

## 任务 6：note 载荷带上附件元数据

- 改 `server/hydrate.ts`：`hydrateNotes` 解析正文里的附件 id，返回 `attachments: [{id,kind,mime,name,bytes}]`。
- 新增 `tests/unit/hydrate-attachments.test.mts`：正文含图片 + 文件 + 陌生 id 时只返回库里有的。
- 验收：`GET /api/notes` 里能看到 `attachments`。

## 任务 7：前端（渲染 + 上传入口 + 样式 + i18n）

- 新增 `web/lib/files.ts`：`kindOfMime` / `humanSize` / `fileMetaMap` / `renderAttachmentNodes(html, map, apiBase)`（纯函数）。
- 改 `web/components/Markdown.tsx`：接 `attachments`，按映射把 img/a 换成 video/audio/下载卡片。
- 改 `web/pages/notes/useImageUpload.ts` → `useAttachmentUpload`（图片仍压缩，其它类型原样），`Composer` / `NoteCard` 改入口文案与 `accept`。
- 改 `web/lib/api/attachments.ts`：带 `x-pinfolio-upload: 1`。
- 改 `web/styles/notes.css`（附件卡片 / 播放器宽度）、`shared/i18n/en/notes.ts` + 服务端文案。
- 新增 `tests/unit/files-render.test.mts`。
- 验收：`pnpm build:web` 通过；单测绿。

## 任务 8：e2e（假 S3，不碰真实桶）

- 新增 `tests/fakes3.mjs`（PUT/GET/HEAD/DELETE + Range，忽略签名）。
- 新增 `tests/e2e-file.mjs`：上传假 mp4 → 便签 → 取文件 200 / Range 206 → 删便签 → 对象被删。
- 改 `tests/run.mjs`：把 `e2e-file` 加进 core 套件，并给隔离实例注入假 S3 的 env。
- 验收：`node tests/run.mjs --only=core` 全绿。

## 任务 9：文档

- `docs/api.zh.md` / `docs/api.md`：上传/取文件的请求头、100 MB、Range、错误码。
- `docs/features.zh.md` / `docs/features.md`：附件一节改写（任意类型 + 对象存储 + 15 GB 上限）。
- `docs/backup-restore*.md`：附件不在备份包里，怎么单独搬。
- `.env.example`、`docker-compose.yml`：`ATTACHMENTS_QUOTA_BYTES` + `S3_*`。
- `CHANGELOG.md` 一条。

## 任务 10：上线 os

- 建 bucket `pinfolio`（私有 Standard）+ 专用 Customer Secret Key。
- 改 `/opt/pinfolio/compose.yml` 注入 `S3_*`（文件 600，不进 git）。
- nginx `personal-raylx-top.conf` 的 pinfolio vhost `client_max_body_size 128m`，`nginx -t && systemctl reload nginx`。
- 代码进 GitHub `dev` → os 上 `/opt/pinfolio-demo/src` 拉取 → `docker build` → 派生 `pinfolio:0.5.0-ssh` → `compose up -d`。
- 验收：规格 §6 的 5 条，逐条贴证据。
