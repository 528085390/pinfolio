# 02 · 鉴权与会话

- 状态：**已实施**（2026-10-23，提交 `b0330d6`）
- 依赖：01（新增表走 migration v2）
- 被依赖：03（settings 表存口令）、04（`PINBOARD_PASSWORD`）、07（CI 的鉴权 e2e）

## 目标

公网部署后，除白名单外一律要求身份；单用户、无注册。

## 身份模型

- 密码只有两个来源：首次访问 `/setup` 设置；或启动时给 `PINBOARD_PASSWORD`（**仅在没有已存密码时生效**）。
- 哈希：`scrypt(N=16384, r=8, p=1)`，16 字节随机 salt，存 `settings` 表的 `password_hash`，格式 `scrypt$<salt_b64>$<hash_b64>`。
- 比较用 `timingSafeEqual`。
- 忘记密码：`node dist/server.js --reset-password`（或 `pnpm start -- --reset-password`）删除 `password_hash` 后退出，下次访问回到 `/setup`。

## 新增数据表（migration v2）

```sql
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,   -- 随机 16B hex
  token_hash   TEXT NOT NULL,      -- sha256(cookie 值)
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  ua           TEXT NOT NULL DEFAULT '',
  ip           TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL,      -- 只存 hash，明文只在创建时显示一次
  created_at   TEXT NOT NULL,
  last_used_at TEXT
);
```

## 登录与会话

- 登录成功 → 生成 32 字节随机 token；cookie 名 `pb_session`，属性 `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`；`Secure` 仅在 HTTPS（`TRUST_PROXY=1` 且 `X-Forwarded-Proto=https`，或直连 TLS）时加。
- 库里只存 `sha256(token)`；每次请求校验哈希 + `expires_at`；命中则顺延 30 天并更新 `last_seen_at`（同一会话 60 秒内不重复写库）。
- 登出：删当前会话行 + 清 cookie。

## 设备管理（设置页）

- 列出所有会话：UA 摘要、IP、最近活跃、创建时间；当前设备标「本机」。
- 单个踢下线、全部下线（保留当前会话）。

## 防爆破

- 同 IP 15 分钟内 5 次失败 → `429`，进入指数退避（30s → 60s → 120s …，上限 15 分钟）。
- 成功登录清零；计数在内存里，同时落 `settings`（进程重启不丢）。
- 只对 `POST /api/auth/login` 生效。

## CSRF

不引入 token。依赖两条：`SameSite=Lax`（跨站表单 POST 不带 cookie）+ 现有约定「写接口必须 `Content-Type: application/json`」；中间件对写方法强制校验该头，不符合返回 `415`。

## 路由边界

| 路径 | 是否公开 |
|---|---|
| 静态资源、SPA 壳（`/`、`/notes` …） | 公开（壳里没有数据） |
| `GET /api/health` | 公开，只返回 `{ ok: true }` |
| `POST /api/auth/login`、`GET /api/auth/state`、`POST /api/auth/setup` | 公开 |
| 其余 `/api/*` | **默认全锁**，未登录 `401` |

实现：在 `server/index.ts` 的 `api` 子应用上挂一个中间件，白名单放行，其余校验会话或 Bearer。

## API token（机器访问）

- 设置页生成：`pb_` + 32 字节 base64url，**明文只显示一次**，库里只存 hash。
- `Authorization: Bearer <token>` 通过鉴权，不走 cookie、不需要 CSRF 校验。
- 脚本改造：`tools/seed-assets.mjs`、e2e 脚本改读 `PINBOARD_TOKEN` 环境变量。

## 前端

- `/login`、`/setup` 两个独立路由（不进六页壳）。
- 任何 `/api` 返回 `401` → 清本地状态、跳 `/login?next=<当前路径>`。
- 设置页新增「安全」卡片：改密码、设备列表（踢下线）、API token 列表（新建 / 删除，明文只显示一次）。

## 验收

- 单测：scrypt 往返与错误密码拒绝；token hash；限流窗口与退避曲线；白名单矩阵（每个公开路由放行、其余 401）。
- e2e：未登录 `GET /api/notes` → 401；登录后 → 200；带 Bearer → 200；登出后 → 401；`/setup` 只能成功一次。
- 手工：手机上登录后重开浏览器仍在登录态；设备列表能踢掉另一条会话。

## 不做

- 多用户、注册、角色权限、OAuth/SSO、邮件找回密码、2FA。
- 不引入 CSRF token（理由见上）。
