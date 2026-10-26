// 服务端：观测（kuma）与主机指标（metrics）的英文译文。
// 只收本区域的文案；公共词在 common.ts，外壳在 shell.ts。
// 这些字符串都是 HTTP 响应体里回给前端的 error / message，由 server/i18n.ts 的 t() 按请求 locale 取。
import type { Dict } from '../core'

export const serverMonitor: Dict = {
  // 观测项写操作与读取（server/kuma/routes.ts）
  '读不到 Kuma：{msg}': 'Can’t read Kuma: {msg}',
  '读不到 Kuma 状态页：{msg}': 'Can’t read the Kuma status page: {msg}',
  '观测项 id 不合法': 'Invalid monitor id',
  '写操作必须用 application/json': 'Write requests must use application/json',
  '请求体不是合法 JSON': 'The request body is not valid JSON',
  '要删除必须把观测项名字原样输对（当前是「{name}」）': 'To delete, type the monitor name exactly (currently “{name}”)',
  '这个观测项已暂停，先恢复再立即观测': 'This monitor is paused; resume it before running it now',

  // 连 Kuma（server/kuma/client.ts）
  '连不上 Kuma（{url}）：{msg}': 'Can’t reach Kuma ({url}): {msg}',
  '登录超时': 'Login timed out',
  '没有配置 Kuma 口令：设置环境变量 KUMA_PASS，或把口令写进 data/kuma-pass.txt':
    'No Kuma password configured: set the KUMA_PASS environment variable, or put the password in data/kuma-pass.txt',
  '登录被拒（检查 KUMA_USER / KUMA_PASS）': 'Login rejected (check KUMA_USER / KUMA_PASS)',
  'Kuma 无响应：{event}': 'Kuma did not respond: {event}',
  'Kuma 拒绝了 {event}': 'Kuma rejected {event}',
  '拿观测项列表超时': 'Timed out fetching the monitor list',
  'Kuma 没有观测项 #{id}': 'Kuma has no monitor #{id}',

  // 观测项字段校验（server/kuma/patch.ts）
  '名字不能为空': 'Name cannot be empty',
  '名字最长 120 字': 'Name is at most 120 characters',
  '已经有同名观测项：{name}': 'A monitor with that name already exists: {name}',
  '有策略按名字引用了「{name}」（观测项 #{refs}），改名会让策略失效。请先把那些策略改成按 id 引用或改掉名字。':
    'A policy references the monitor by name “{name}” (monitor #{refs}), so renaming it would break that policy. Please switch those policies to id references, or rename them first.',
  '介绍最长 500 字': 'Description is at most 500 characters',
  '检查频率要在 20–86400 秒之间': 'The check interval must be between 20 and 86400 seconds',
  '超时要在 1–120 秒之间': 'The timeout must be between 1 and 120 seconds',
  '重试间隔要在 1–3600 秒之间': 'The retry interval must be between 1 and 3600 seconds',
  '重试次数要在 0–10 之间': 'Retries must be between 0 and 10',
  '超时（{timeout}s）必须小于检查频率（{interval}s）': 'The timeout ({timeout}s) must be less than the check interval ({interval}s)',

  // 立即观测：配方（server/kuma/recipe.ts）
  // STEP_LABEL 是模块级常量，值保持中文原文，渲染时再 t() 一次，所以这里也要收它的三个值
  '让 Kuma 立刻探测一次': 'Have Kuma probe once right now',
  '发一个 HTTP 请求': 'Send an HTTP request',
  '跑一条命令': 'Run a command',
  '步骤：{type}': 'Step: {type}',
  '配方里有不认识的步骤类型：{type}': 'The recipe has an unknown step type: {type}',
  '配方里没有步骤': 'The recipe has no steps',
  '推送型观测项由外部心跳驱动，Kuma 没有「立刻探一次」这回事；要在抽屉里点按钮，请给它在 monitor-actions.json 里配一条配方。':
    'A push monitor is driven by external heartbeats — there is no “probe once now” in Kuma. To get a button in the drawer, give it a recipe in monitor-actions.json.',
  '重启检查循环，Kuma 会马上跑一次真实探测': 'Restarts the check loop, so Kuma runs one real probe right away',
  '未知': 'Unknown',

  // 立即观测：执行（server/kuma/runner.ts）
  '（无消息）': '(no message)',
  '重启检查循环后 {n} 秒内没有产生新心跳': 'No new heartbeat within {n} seconds of restarting the check loop',
  '配方里没写 url': 'The recipe has no url',
  '配方里没写 argv': 'The recipe has no argv',
  '命令起不来：{msg}': 'Cannot start the command: {msg}',
  '命令超时（{n} 秒）被杀掉': 'The command timed out ({n}s) and was killed',
  '退出码 0': 'Exit code 0',
  '退出码 {code}': 'Exit code {code}',
  '整套配方超过 {n} 秒，后面的步骤没跑': 'The whole recipe took over {n} seconds, so the remaining steps did not run',
  '不认识的步骤类型：{type}': 'Unknown step type: {type}',

  // 立即观测：调 kuma-monitor CLI（server/kuma/kuma-cli.ts）
  'kuma-monitor 超时（{cmd}）': 'kuma-monitor timed out ({cmd})',
  '跑不起来 kuma-monitor：{msg}': 'Cannot run kuma-monitor: {msg}',
  'kuma-monitor 退出码 {code}': 'kuma-monitor exited with code {code}',
  'kuma-monitor 没回组 id：{out}': 'kuma-monitor returned no group id: {out}',
  'kuma-monitor 没回监视器 id：{out}': 'kuma-monitor returned no monitor id: {out}',

  // 策略摘要（server/kuma/redact.ts）
  // 这一组是按句子片段拼的，片段里的空格在中文里是排版用的，英文照样保留
  '推送型（由外部心跳驱动）': 'Push (driven by external heartbeats)',
  '{n} 小时': '{n}h',
  '{n} 分钟': '{n}m',
  '条件': 'condition',
  // 引用观测项名字用的中文引号，英文换成弯引号
  '「': '“',
  '」': '”',
  '时间 ': 'time ',
  '关联观测项': 'linked monitor',
  ' 为 ': ' is ',
  '状态为 ': 'status is ',
  '星期 ': 'weekday ',
  ' 且 ': ' and ',
  '自定义': 'Custom',
  '（否则每 {n}复查一次）': ' (otherwise recheck every {n})',
  '门控：{when} 才检查{recheck}': 'Gate: check only when {when}{recheck}',
  '频率：固定每 {n}': 'Interval: fixed every {n}',
  '频率：默认每 {n}': 'Interval: {n} by default',
  '{when} → 每 {n}': '{when} → every {n}',
  '另有 {n} 条规则': (v) => `${v.n} more ${Number(v.n) === 1 ? 'rule' : 'rules'}`,
  '门控 + 条件频率': 'Gate + conditional interval',
  '门控': 'Gate',
  '条件频率': 'Conditional interval',
  '自定义策略': 'Custom policy',

  // 主机清单与校验（server/metrics/hostmeta.ts）
  '主机 id 不能为空': 'Host id cannot be empty',
  '主机 id 最长 {n} 位': 'Host id is at most {n} characters',
  '主机 id 只能用字母、数字、点、下划线、短横线': 'A host id may only contain letters, digits, dots, underscores and hyphens',
  '名字最长 {n} 字': 'Name is at most {n} characters',
  '备注最长 {n} 字': 'Note is at most {n} characters',
  '地址最长 100 字': 'Address is at most 100 characters',
  // 下面两条是**前缀**，metrics/routes.ts 用同一个 t() 前缀判 409 / 404，英文值必须带结尾空格
  '已经有这台主机：': 'This host already exists: ',
  '没有这台主机：': 'No such host: ',

  // 主机接口（server/metrics/routes.ts）
  '还没配指标源：在 data/metrics.json 里写 base 和 hosts': 'No metrics source configured yet: put base and hosts in data/metrics.json',
  '需要 application/json': 'application/json is required',
  'systemd 探测要填 SSH 用户名（{unit}）': 'The systemd monitor needs an SSH username ({unit})',
  'systemd 探测要填 SSH 私钥路径（{unit}）': 'The systemd monitor needs an SSH private key path ({unit})',
  '读不到私钥：{path}': 'Cannot read the private key: {path}',
  '私钥文件太大（超过 64 KB）：{path}': 'The private key file is too large (over 64 KB): {path}',
  '这个文件不是 OpenSSH / PEM 私钥：{path}': 'This file is not an OpenSSH / PEM private key: {path}',
  '勾了观测项就要填主机地址（IP 或域名）': 'Tick monitors only after filling in the host address (IP or domain)',
  '找不到 kuma-monitor：{path}': 'kuma-monitor not found: {path}',
  '要手输主机 id（{id}）确认删除': 'Type the host id ({id}) to confirm the delete',

  // 接入机器 / 采集端参数（server/metrics/onboard.ts）
  'metrics base 为空，无法生成上报地址': 'The metrics base is empty, so the ingest URL cannot be built',
  'metrics base 里没有 /metrics/ 段，无法生成上报地址': 'The metrics base has no /metrics/ segment, so the ingest URL cannot be built',
  'metrics base 里没有 token，无法生成上报地址': 'The metrics base has no token, so the ingest URL cannot be built',
  '单元名只能用字母、数字、@ : . _ -：{unit}': 'A unit name may only contain letters, digits, @ : . _ -: {unit}',
  '服务清单最多 {n} 个': 'The service list holds at most {n} units',
  '磁盘路径要以 / 开头，且不能含空格：{p}': 'A disk path must start with / and contain no spaces: {p}',
  '磁盘路径最多 {n} 个': 'At most {n} disk paths',

  // 拉取指标（server/metrics/poll.ts）
  '没配指标源 base（data/metrics.json）': 'No metrics source base configured (data/metrics.json)',
  '不是指标 JSON': 'Not a metrics JSON',
  '超时': 'Timed out',

  // 加主机时顺带建观测项（server/kuma/provision.ts）
  '端口必须是 1–65535 的整数：{port}': 'Port must be an integer between 1 and 65535: {port}',
  '缺少主机地址，端口探测没法建': 'No host address, so the port monitor cannot be created',
  'HTTP 站点地址要以 http:// 或 https:// 开头：{url}': 'The HTTP site URL must start with http:// or https://: {url}',
  'systemd 服务缺单元名': 'The systemd service has no unit name',
  '单元名只能是字母、数字、点、下划线、@、冒号、短横线：{unit}': 'A unit name may only contain letters, digits, dots, underscores, @, colons and hyphens: {unit}',
  '缺少主机地址，systemd 探测没法建': 'No host address, so the systemd monitor cannot be created',
  'systemd 探测需要 SSH 用户名': 'The systemd monitor needs an SSH username',
  'systemd 探测需要 SSH 私钥内容': 'The systemd monitor needs the SSH private key contents',
}
