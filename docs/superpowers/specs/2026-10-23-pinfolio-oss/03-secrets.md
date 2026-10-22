# 03 · 静态加密（密钥落库）

- 状态：待实施
- 依赖：01（迁移）、02（`settings` 表）
- 被依赖：04（`secret.key` 进容器卷）

## 问题

`mail_accounts.password` 是明文 TEXT 列；`data/kuma-pass.txt` 明文；`data/metrics.json` 的 base 里带采集 token。备份或库文件一旦泄漏即全泄。

## 主密钥

优先级：

1. `PINBOARD_SECRET`（32 字节 base64）；
2. `data/secret.key`（文件内容同格式）；
3. 都没有 → 首次启动生成并写 `data/secret.key`（权限 `0600`）。

密钥缺失或长度不对 → 启动报错并打印生成命令，不静默降级成明文。

## 派生与存储格式

- `HKDF-SHA256(secret, info="pinfolio/v1")` → 32 字节 AES key；
- `AES-256-GCM`，随机 12 字节 IV；
- 存储：`enc:v1:<iv_b64>:<tag_b64>:<ct_b64>`（版本前缀留给将来轮换）；
- 解密失败（tag 不匹配 / 未知版本）→ 该字段按「不可用」处理，页面显示解密失败提示，进程不崩。

## 覆盖范围

| 位置 | 现状 | 目标 |
|---|---|---|
| `mail_accounts.password` | 明文 TEXT | 写库前加密，读库后解密 |
| `data/kuma-pass.txt` | 明文文件 | 首次启动迁入 `settings.kuma_pass`（加密），文件内容改写成 `enc:v1:...` 保留兼容 |
| `data/metrics.json` 的 `base` | 含采集 token 的 URL | 原地加密写回 `enc:v1:...`，读取时透明解密 |

## 懒迁移

启动时扫描上述位置，遇到没有 `enc:v1:` 前缀的就地加密；幂等，可反复跑。迁移前按 05 的规则先备份。

## 边界（已向用户说明）

静态加密只防「备份 / 库文件泄漏」，**防不了进程被控**：能读内存或能执行代码的攻击者照样拿到明文。

## 验收

- 单测：加解密往返；篡改 tag 抛错；幂等迁移（跑两次结果一致）；密钥缺失的报错文案。
- 手工：库副本把 `mail_accounts.password` 改成明文 → 启动后变成 `enc:v1:`，邮件页仍能正常收信。
- `data/metrics.json` 加密后，主机页仍能拉到指标。

## 不做

- 密钥轮换 UI、KMS/HSM、字段级权限控制。
- 不加密整库（SQLCipher 之类）。
