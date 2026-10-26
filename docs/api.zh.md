# pinfolio HTTP API

前端用到的全部接口。概览见 [README](../README.zh.md)。

所有接口都在 `http://127.0.0.1:7788/api` 下，JSON 进 JSON 出。**除 `/health` 与 `/auth/*` 外都要登录**（会话 cookie，或 `Authorization: Bearer <api token>`）；带 body 的写接口只认 `Content-Type: application/json`（跨站表单发不出这个头，这就是 CSRF 防线），**唯一例外是图片上传**——它的请求体就是图片二进制。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查，返回数据库路径 |
| GET | `/bootstrap` | 启动数据：`{ tags, fields }` |
| GET | `/stats` | 统计：便签数、未完成数、已完成数、资产数、在用数、总价、30 天内到期、已过期、到期列表 |
| GET | `/search?q=` | 全局搜索，返回 `{ notes, assets }` |
| GET | `/export` | 导出整库 JSON |
| POST | `/seed` | 灌示例数据（仅空库时生效） |
| GET | `/notes` | 列表，支持 `q` `tag` `pinned` `done` `archived` `assetId` |
| GET/POST | `/notes/:id`、`/notes` | 单条 / 新建 |
| PATCH/DELETE | `/notes/:id` | 修改（`content` `pinned` `done` `archived` `assetId`）/ 删除 |
| POST | `/attachments` | 上传一张图：**请求体就是图片二进制**，`Content-Type: image/*`（唯一不走 JSON 的写接口）。`?name=` 记原始文件名、`?noteId=` 可先绑到某条便签。按魔数只收 PNG / JPEG / WebP / GIF（SVG 415）、空文件 400、超 10 MB 413。回 201 `{ id, url, mime, bytes, name }`，`url` 就是 `/api/attachments/<id>` |
| GET | `/attachments/:id` | 取图。`Content-Type` 按存的类型回，`Cache-Control: private, max-age=31536000, immutable`（同一个 id 的内容永不改写，换图 = 新 id），`Content-Disposition: inline`。记录不存在、或 `data/uploads/` 里的文件被手工删了，都是 404 |
| GET | `/assets` | 列表，支持 `q` `kind` `status` `tag` |
| GET | `/assets/:id` | 详情，附 `linkedNotes`（已带标签） |
| POST/PATCH/DELETE | `/assets`、`/assets/:id` | 新建 / 修改 / 删除 |
| GET/POST | `/tags` | 标签列表（带便签数、资产数）/ 新建 |
| PATCH/DELETE | `/tags/:id` | 改名改色 / 删除 |
| GET/POST | `/fields` | 自定义字段列表 / 新建 |
| PATCH/DELETE | `/fields/:id` | 修改 / 删除 |
| GET | `/monitors` | 观测台数据：`{ kuma, updatedAt, summary, groups, quick }`，聚合 Kuma 状态页 + 心跳；`quick` 是根目录 `quick-links.json` 的快捷入口卡（`{ name, url, note, label, icon }[]`，只是外链、不进 summary 与筛选）；`?fresh=1` 强制重取观测项清单（清单缓存 5 分钟，心跳 5 秒） |
| GET | `/monitors/meta` | 连的是哪个 Kuma、到底配没配：`{ configured, flavor, url }`。`flavor` 由 monitor 上的 `policyJson` 判定（`fork`/`upstream`，缓存 5 分钟，探测失败按 upstream，可用 `KUMA_FLAVOR` 强制）；`configured=false` 时前端显示引导卡 |
| GET | `/monitors/:id` | 单个观测项详情：`{ monitor, latest, beats, action, link }`（敏感字段已脱敏，不含 SSH 私钥 / 密码 / token） |
| PATCH | `/monitors/:id` | 改名 / 改介绍 / 改频率 / 改超时重试（`name` `description` `interval` `timeout` `maxretries` `retryInterval` `showMsg`），写回 Kuma；重名、被策略按名字引用、超时 ≥ 频率都会被拒 |
| POST | `/monitors/:id/pause`、`/monitors/:id/resume` | 暂停 / 恢复观测（Kuma 不再探测，历史心跳保留） |
| DELETE | `/monitors/:id?confirm=<名字>` | 删除观测项（名字必须原样输对）；先备份 `kuma/data/kuma.db` 到 `kuma/backups/`，再连带历史心跳删除 |
| POST | `/monitors/:id/check` | 立即观测：按配方顺序执行并逐步骤返回 `{ ok, steps: [{ type, label, ok, detail, ms }], latest }`；暂停中或推送型没配方会被拒 |
| GET/POST | `/mail/accounts` | 信箱列表（`?counts=1` 带未读数）/ 新建。**任何返回都不含密码**，只给 `hasPassword`；带 `proxy` 字段（空 = 直连） |
| PUT/DELETE | `/mail/accounts/:id` | 修改（密码留空 = 不改）/ 删除（连带清掉本地已读标记） |
| POST | `/mail/accounts/test` | 测连接，收原始参数或 `{id}`（复用已存密码与代理）；失败返回可读中文原因（配了代理会说明是「经代理 …」失败） |
| GET | `/mail/folders?account=` | 文件夹列表（带 special-use，只列可选中的） |
| GET | `/mail/messages?account=all\|<id>&folder=INBOX&limit=50&offset=0` | 合并收件箱一页；`?fresh=1` 绕过 60 秒缓存（前端每 60 秒自动轮询也用它）。返回 `{ items, total, unseen, hasMore, errors, partial, fetchedAt }`，`fetchedAt` 是这批数据从 IMAP 取回的时刻 |
| GET | `/mail/message?account=&folder=&uid=` | 单封正文（`text` / `html` / 附件清单） |
| GET | `/mail/attachment?account=&folder=&uid=&index=` | 下载附件（`Content-Disposition` 带中文文件名） |
| POST/DELETE | `/mail/local-read` | 标记本地已读 / 取消（`account=all` 或指定 id 清空）。**没有写服务器的接口** |
| GET | `/hosts` | 主机指标：`{ hosts, updatedAt, polledAt, pollOk, pollFailed, samples }`。每台机一条最新样本（CPU / 内存 / 磁盘 / 负载 / 服务 / top 进程…）外加 `id`、`label`、`note`、`paused`、`online`、`staleSec`（超过 900 秒算陈旧）、`series`（24 小时的 `[ts, cpuPct, memPct]`）与 `unitMonitors`（`{ unit: { id, name } }`，服务 chip 要跳的观测项，按 `host-services.json` 解析；对不上的 unit 不出现，chip 就是纯文字）。暂停的机既不算在线也不算陈旧，且永远不进 `pollFailed`。库是空的时候这个请求会**等**拉取完再回，不返回空数组 |
| POST | `/hosts` | 往 `data/metrics.json` 加一台机：`{ id, label?, note?, units?, disks?, address?, port?, http?: { url, keyword? }, services?: [{ unit, user, keyPath }] }`。`id` 限 1–32 位 `[A-Za-z0-9._-]`，`label` 默认等于 `id`，重名回 409。`units` / `disks` / `address` 是采集端参数（之后 `GET /hosts/:id/onboard` 原样复用）；`port` / `http` / `services` 是「顺带建」的观测项 —— 必须同时给 `address`（否则 400），SSH 私钥在写盘前先从 `keyPath` 读好（读不到直接 400，不留半台机）。观测项是尽力而为：建失败主机照样保留，回包里带 `provision: { ok, groupId?, groupName?, monitors?, error? }`。原子写回（保留 `base` 与未知键），随后拉一次。返回新的整包数据 |
| GET | `/hosts/:id/onboard` | 采集端一条命令 + `{ installUrl, ingestUrl, units, disks, address, ready, firstSampleAt, staleSec }`。**上报地址里带 token，所以只在这个接口出现** —— `/hosts` 列表和 `SNAPSHOT.md` 里都没有。没有这台机回 404 |
| PATCH | `/hosts/:id` | 改 `{ paused?, label?, note?, units?, disks?, address? }`。`paused: true` 之后不再拉这台机（卡片保留、变灰）；`paused: false` 会立刻拉一次补到最新一帧。没有这台机回 404 |
| DELETE | `/hosts/:id?confirm=<id>&purge=1` | 删一台机 —— id 必须原样输对。`purge=1` 连带删掉它的 `host_metrics` 历史、加主机时顺带建的观测项（记在 `data/metrics.json` 的 `monitors` 里）、空出来的分组，以及 `host-services.json` 里它的映射；回包加 `{ purged, monitorsDeleted, monitorsFailed }`。没有这台机回 404 |
| POST | `/hosts/refresh` | 立刻把六台机拉一遍（绕过 4 分钟最小间隔）；要求 `Content-Type: application/json`，否则 415 |
| GET | `/services` | 服务页的部署关系：`{ servers, services, deploys, monitors, file }`，读 `data/services.json`（`SERVICES_FILE` 可换路径），**每次请求热读**，改完刷新页面即生效。`servers` 哪几台机、`services` 哪些项目 / 服务 / 站点 / 脚本 / 任务、`deploys` 谁部署在谁上面（路径、启动方式、端口、`monitor` 观测项 id、可选 `url` 管理页）、`monitors` 是观测项 id → 短名（只用于显示，没登记的退回「观测项 N」）。坏条目跳过、指向没登记的服务器或服务的部署丢掉；`file` 回实际读的路径。**只登记关系，不探测、不产生任何 Kuma 检查** |
| POST | `/services/servers` | 加一台服务器：`{ id, name, vendor?, ip?, user?, note?, doc?, monitors?: [id] }`，可另带 `monitorNames`（`{ "24": "抖音续火花（每日打卡）" }`，一并写进文件的 `monitors` 表，文件自己就能说明 id 是啥）。`id` 限 1–32 位 `[a-z0-9._-]`、以字母或数字开头，不分大小写去重（重名 409）；校验不过 400。**回整份 payload**，页面拿到直接替换，不用再拉一次 |
| PATCH/DELETE | `/services/servers/:id` | 改（只改传进来的字段；改 id 会连带改 `deploys` 里的引用）/ 删（`?confirm=<id>` 手输确认）。**这台机上还有部署就拒绝**，错误里列出挡着的部署 |
| POST | `/services/catalog` | 加一个服务（JSON 里的 `services` 段，路径用 `catalog` 避开 `/services/services`）：`{ id, name, kind?, summary?, doc? }`。`kind` 只能是 `project` / `service` / `site` / `script` / `task`，不写按 `service` |
| PATCH/DELETE | `/services/catalog/:id` | 改 / 删一个服务（删除同样要 `?confirm=<id>`）。改 id 会连带改部署引用；**还有部署挂着就拒绝删除** |
| POST | `/services/deploys` | 加一条部署：`{ server, service, path, runtime?, port?, monitor?: [id], url?, note? }`。`server` / `service` 必须已登记，同一对 `server+service` 只能有一条（重复 409）；`path` 必填，`url` 只收 `http(s)://`。同样可带 `monitorNames` |
| PATCH/DELETE | `/services/deploys/:key` | 改 / 删一条部署，`:key` 是 `server:service`（`%3A` 也认）。删除要 `?confirm=<key>`。改到一对已经存在的组合会被拒。**写接口都要求 `Content-Type: application/json`（否则 415）；每次写盘前先把旧文件备份到 `data/services-backups/services-YYYYMMDD-HHMMSS.json`（留最近 10 份），写回按解析规则规整一遍（坏条目会被清掉），全程不碰 Kuma** |
| GET | `/backup` | 备份状态：`{ local: { dir, keep, files: [{ name, size, mtime }], last, lastOkAt, lastError }, remote: { type, host, port, database, user, table, hasPassword, rows, last, lastError } }` |
| GET | `/backup/local/:name/manifest` | 读包里的 `manifest.json`（成员名 / 大小 / sha256 / 生成时间 / 实例 id） |
| GET | `/backup/local/:name/download` | 下载一个包（`Content-Disposition` 带文件名） |
| DELETE | `/backup/local/:name` | 删一个包（名字必须形如 `pinfolio-*.tar.gz`；`pre-migrate-*` 拒绝删除） |
| POST | `/backup/run` | 立即备份：`{ only?: "local" | "remote" }`，返回新的状态 |
| GET | `/backup/remote` | 远端行（只有元数据，永远不返回 payload） |
| POST | `/backup/remote/test` | 测试连接：`{ type, host, port?, database, user, password?, table? }`，返回服务端版本；密码留空表示复用已存的 |
| POST | `/backup/remote/config` | 保存远端目的地（字段同上，密码加密落盘），缺表时顺手建表 |
| DELETE | `/backup/remote/config` | 断开目的地（已经传上去的行仍留在库里） |
| DELETE | `/backup/remote/:id` | 删远端的一行 |
| POST | `/backup/remote/:id/download` | 把远端某一行取回 `data/backups/`（校验 sha256） |

示例：

```powershell
# 新建一条便签
curl.exe -X POST http://127.0.0.1:7788/api/notes -H "Content-Type: application/json" \
  -d '{"content":"续费 my-server 的证书 #运维 #待办"}'

# 标记完成
curl.exe -X PATCH http://127.0.0.1:7788/api/notes/1 -H "Content-Type: application/json" -d '{"done":true}'
```
