# pinfolio HTTP API

前端用到的全部接口。概览见 [README](../README.zh.md)。

所有接口都在 `http://127.0.0.1:7788/api` 下，JSON 进 JSON 出，无鉴权（只监听本机）。

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
| GET | `/assets` | 列表，支持 `q` `kind` `status` `tag` |
| GET | `/assets/:id` | 详情，附 `linkedNotes`（已带标签） |
| POST/PATCH/DELETE | `/assets`、`/assets/:id` | 新建 / 修改 / 删除 |
| GET/POST | `/tags` | 标签列表（带便签数、资产数）/ 新建 |
| PATCH/DELETE | `/tags/:id` | 改名改色 / 删除 |
| GET/POST | `/fields` | 自定义字段列表 / 新建 |
| PATCH/DELETE | `/fields/:id` | 修改 / 删除 |
| GET | `/monitors` | 观测台数据：`{ kuma, updatedAt, summary, groups }`，聚合 Kuma 状态页 + 心跳；`?fresh=1` 强制重取观测项清单（清单缓存 5 分钟，心跳 5 秒） |
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

示例：

```powershell
# 新建一条便签
curl.exe -X POST http://127.0.0.1:7788/api/notes -H "Content-Type: application/json" \
  -d '{"content":"续费 my-server 的证书 #运维 #待办"}'

# 标记完成
curl.exe -X PATCH http://127.0.0.1:7788/api/notes/1 -H "Content-Type: application/json" -d '{"done":true}'
```
