# 便签附件扩容：任意文件 / 图片 / 视频，单文件 100 MB，对象存储

- 日期：2026-11-10
- 状态：已获用户批准（2026-11-10 21:06，「可以」= 同意设计 + 建资源 + 配额 + 改 nginx）
- 相关：`docs/superpowers/specs/2026-10-23-pinfolio-oss/`（附件与图片的原始设计）

## 1. 要解决的问题

现在的附件系统（v3，2026-10-26）只收 **PNG / JPEG / WebP / GIF**，单张上限 **10 MB**，
真身落在 `<数据目录>/uploads/<id>.<ext>`，随每日备份打进 tar 包。

用户要的是：**便签能挂任意类型文件（含视频），单文件最大 100 MB，用对象存储**。

三条硬约束决定了方案：

1. **数据盘不是用来放视频的**：`os` 的 `/mnt/data` 只有 49 G，且每日 tar 备份会把附件一起打包 ——
   一个 100 MB 的视频进包一次，14 份保留就是 1.4 GB，备份链路先崩。附件必须离开备份包。
2. **同源任意文件 = XSS 面**：现有代码拒绝 SVG 就是这条（坑 57）。放开任意类型后不能靠"只收四种"兜底了。
3. **Oracle 免费对象存储有共享额度**：20 GB / 月 50,000 次 API 请求，restic 备份已经在同一个 tenancy 里用掉一部分。

## 2. 存储选型（用户已确认）

用 **Oracle Cloud Infrastructure Object Storage**，不用 Cloudflare R2。

| 项 | OCI Always Free（实测 + 官方文档） | Cloudflare R2 免费档 |
|---|---|---|
| 存储 | **20 GB**（Standard + IA + Archive 合计） | 10 GB |
| 请求 | 50,000 次 API 请求 / 月 | 1M 写 / 10M 读 / 月 |
| 出口流量 | **10 TB / 月**（Always Free 通用额度） | 零出口费 |
| 前置条件 | 已有 tenancy + 凭据（`C:\Users\huang\.oci`），已有 bucket `restic-backup` 在跑 | 要绑卡、另开账号 |
| 区域 | `ap-tokyo-1`（= `os` 所在区，同区取数） | 无区域概念 |

实测（2026-11-10 21:0x）：`oci os ns get` → 命名空间 `nrx1ozdaernl`；bucket `restic-backup` 139 对象 / 0.44 GB；
restic 走 S3 兼容端点 `nrx1ozdaernl.compat.objectstorage.ap-tokyo-1.oraclecloud.com`。

**共享额度的处理**：新建独立 bucket `pinfolio`（私有），但 20 GB 与 restic 共用 ——
所以应用层设总量上限 **15 GB**（`ATTACHMENTS_QUOTA_BYTES`），给 restic 留 5 GB。
50,000 请求/月同样共享：restic 多机每日备份估 1~1.5 万，剩约 3.5 万次（≈1100 次/天）够个人用。

**可切换性**：存储层抽象成 S3 兼容驱动，OCI / R2 / MinIO 都只是换 4 个环境变量；
不配就是本地磁盘（桌面版行为不变）。

## 3. 架构

### 3.1 存储层（新增 `server/storage/`）

| 文件 | 职责 |
|---|---|
| `sigv4.ts` | 纯函数：AWS SigV4 签名（canonical request / string-to-sign / signing key）。用 `node:crypto`，不引 SDK。AWS 官方测试向量可直接单测。 |
| `config.ts` | 纯函数：从环境变量解析出 `{ driver: 'local' \| 's3', endpoint, region, bucket, accessKeyId, secretAccessKey, prefix }`。四个必填项齐了才算 `s3`，否则 `local`。 |
| `s3.ts` | S3 兼容客户端：`putObject` / `getObject(range?)` / `headObject` / `deleteObject`。用 `undici`（已是依赖）。路径风格 `<endpoint>/<bucket>/<key>`。 |

**为什么手写 SigV4 而不引 `@aws-sdk/client-s3`**：① 仓库一贯零重依赖（tar / gzip / 备份都是手写 + 单测）；
② AWS SDK v3 默认给 PUT 加 `x-amz-checksum-*`，OCI 的 S3 兼容层会拒；③ 签名是纯函数，比 SDK 更好测。

对象键：`<prefix><id>.<ext>`（`prefix` 默认 `att/`）。键里不放原始文件名 —— 路径穿越、重名、中文编码问题一概不碰（沿用本地存储的规矩）。

### 3.2 数据模型（迁移 v5）

`attachments` 加 4 列（旧行默认 `local` / `image`，幂等可重跑）：

| 列 | 类型 | 含义 |
|---|---|---|
| `kind` | TEXT NOT NULL DEFAULT 'image' | `image` / `video` / `audio` / `file`，决定前端怎么渲染 |
| `storage` | TEXT NOT NULL DEFAULT 'local' | `local` / `s3` |
| `object_key` | TEXT NOT NULL DEFAULT '' | 对象存储里的键；本地存储为空 |
| `sha256` | TEXT NOT NULL DEFAULT '' | 内容摘要，上传后核对 / 去重排查用 |

`note_id` 仍然是缓存，「正文是唯一真相」的规矩不变（`syncNoteAttachments` / `sweepAttachments` 原样复用）。

### 3.3 上传

`POST /api/attachments`，请求体就是文件二进制（沿用现有形态，不走 multipart）。

- 鉴权：改成**必须带 `x-pinfolio-upload: 1` 自定义头**（不再只看 `content-type: image/*`）。
  自定义头跨站表单发不出来，浏览器要发它就得走 `fetch` → 触发 CORS 预检 → 我们不放行，CSRF 面关掉。
  同时把 `urlencoded` / `multipart` / `text-plain` 三种 content-type 一律拒（跨站表单只能发这三种）。
- 体积：`Content-Length` 先挡一次，读完再核一次，上限 100 MB（`MAX_UPLOAD_BYTES`）。
- 类型：**按魔数判**（png / jpeg / gif / webp / avif / mp4 / mov / webm / mp3 / m4a / wav / ogg / pdf / zip …），
  认不出的归 `file`，`mime` 取请求头里合法的那个，否则 `application/octet-stream`。
  后缀由 mime 决定（`extForMime`），**永远不信文件名**。
- 配额：`SUM(bytes)` + 本次 > 15 GB → 413 并给出已用/上限。
- 落盘：本地模式写 `uploads/`；对象存储模式 `putObject`。失败就把刚插的行删掉，不留半条记录（沿用现有做法）。

### 3.4 取文件

`GET /api/attachments/:id`，鉴权后：

- 本地：读文件返回（现状）。
- 对象存储：`getObject` 流式转发（不整块读进内存），**透传 `Range`** 返回 206 + `Content-Range`，视频能拖进度条。
- 响应头一律带 `Cache-Control: private, max-age=31536000, immutable`（同一个 id 内容永不改写）、`X-Content-Type-Options: nosniff`。
- **只有白名单类型 inline**：`image/png|jpeg|webp|gif|avif`、`video/mp4|webm|quicktime`、`audio/mpeg|mp4|ogg|wav`、`application/pdf`。
  其余（含 `image/svg+xml`、`text/html`、`application/xml`）一律 `Content-Disposition: attachment`。
  `Content-Type` 只从库里存的 mime 出，绝不回显请求头。

### 3.5 前端渲染

正文里插的东西仍然只有两种 Markdown 形态，**正文是唯一真相**：

- 图片：`![](/api/attachments/12)`（不变，老数据原样可用）
- 其它：`[文件名](/api/attachments/12)`

`/api/notes` 返回的每条便签多一个 `attachments: [{id, kind, mime, name, bytes}]`（由正文里的 id 解析 + 查库）。
`Markdown` 组件按这份映射做三件事（都在 DOMPurify 之后）：

1. `<img>` 指向视频 / 音频 → 换成 `<video controls preload="metadata">` / `<audio controls>`
2. `<a>` 指向非图片附件 → 换成下载卡片（类型图标 + 文件名 + 体积）
3. 图片 → 保持原样，继续走灯箱

渲染不出来（映射缺项，比如正文里手写了陌生 id）时退回原生 `<a>` / `<img>`，不报错。

### 3.6 备份、演示、快照

- **对象存储里的附件不进备份 tar 包**（这正是目的）。备份清单里加一条说明：附件在对象存储。
  `docs/backup-restore*.md` 补「附件不在包里，用 rclone / oci os object 单独搬」。
- 演示站（`PINBOARD_DEMO=1`）每日重置：删便签时连带删对象（走同一个 `deleteAttachmentsForNote`），无需额外逻辑。
- `SNAPSHOT.md`：图片引用照旧收成 `[图片]`，文件引用收成 `[附件：文件名]`。

### 3.7 部署

- `os`：新建 bucket `pinfolio`（私有、Standard），新建专用 Customer Secret Key，
  写进 `/opt/pinfolio/compose.yml` 的 environment（不进 git）。
- nginx `pinfolio.raylx.top` 的 `client_max_body_size` **32m → 128m**（100 MB 文件 + 余量）。
- 镜像重建沿用现有链路：改 GitHub `dev` → `os` 上 `/opt/pinfolio-demo/src` 拉代码 `docker build` → 派生 `pinfolio:0.5.0-ssh`。

## 4. 测试

- **单测（新增）**：`sigv4.test.mts`（AWS 官方 SigV4 测试向量 + 查询串规范化）、
  `attachments-kind.test.mts`（魔数识别 / mime→ext / inline 白名单 / 体积上限）、
  `attachments-markdown.test.mts`（文件 Markdown / 快照收口）。
- **单测（扩充）**：`attachments-store.test.mts` 覆盖 `s3` 分支（注入假客户端）。
- **e2e**：`e2e-file.mjs` —— 隔离实例 + **本地假 S3 服务**（忽略签名，实现 PUT/GET/HEAD/DELETE，支持 Range）：
  上传 3 MB 假 mp4 → 便签正文出现链接 → 取文件 200 且 `Content-Type: video/mp4` → `Range: bytes=0-99` 返回 206 →
  正文删掉链接 → 7 天清扫逻辑删对象（用可注入的 now）。

## 5. 明确不做（YAGNI）

- 不做预签名直传（浏览器 → OCI）。理由：要配 bucket CORS、两段式接口、孤儿对象治理，
  而单用户代理上传在 24 GB / 4 OCPU 的机器上毫无压力。
- 不做分片上传（>100 MB 一律拒）。
- 不做附件搜索 / 图片 EXIF / 缩略图生成。
- 不改邮箱附件的存储方式（邮件附件是另一条链路）。

## 6. 验收

1. `pnpm typecheck && pnpm test:unit` 全绿；`node tests/run.mjs --only=core` 全绿（含新 e2e）。
2. 线上 `https://pinfolio.raylx.top/`：贴一个 5 MB 以上的视频 → 卡片里出播放器、能拖进度条；
   上传 `~/x.bin`（5 MB）→ 出下载卡片、下载后 sha256 与本地一致。
3. 数据库 `SELECT id,kind,storage,object_key,bytes FROM attachments ORDER BY id DESC LIMIT 5` 与 OCI bucket 里的对象对得上。
4. 备份包大小没有因为附件暴涨（附件不在包里）。
5. 上传 105 MB 文件被 413 拒；上传 `<svg onload=alert(1)>` 被按 `file` 存、取用时是 `attachment` 不是 inline。
