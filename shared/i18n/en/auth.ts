// 登录 / 首次设密码页。
import type { Dict } from '../core'

export const auth: Dict = {
  '第一次使用，先设个密码': 'First run — set a password',
  '需要密码才能进入': 'A password is required to continue',
  '设置密码': 'Set password',
  '密码': 'Password',
  '至少 8 位': 'At least 8 characters',
  '再输一次': 'Repeat password',
  '密码至少 8 位': 'The password must be at least 8 characters',
  '两次输入不一致': 'The two passwords do not match',
  '请输入密码': 'Enter your password',
  '请求失败（{status}）': 'Request failed ({status})',
  '连不上服务，请检查网络后重试': 'Cannot reach the server — check your network and try again',
  '稍等…': 'One moment…',
  '设置并进入': 'Set password and continue',
  '进入': 'Continue',
  '密码只存在这台机器的数据库里，忘记可用 --reset-password 重置。':
    'The password is stored only in this machine’s database; if you forget it, reset with --reset-password.',
  '会话保留 30 天，设置页可以踢掉其他设备。':
    'Sessions last 30 days; the settings page can sign out your other devices.',
  // 演示站
  '这是演示站，口令已经填好，直接点「进入」就行。':
    'This is the live demo — the password is already filled in, just press Continue.',
  '示例数据每天{reset}自动重置，改动不会保留。':
    'Sample data resets every day at {reset}; your changes will not be kept.',
}
