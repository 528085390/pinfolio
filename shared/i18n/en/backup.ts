// 备份页的英文译文。
// 只收本区域的文案；公共词在 common.ts，外壳在 shell.ts。
import type { Dict } from '../core'

export const backup: Dict = {
  // 本机文件
  '本机文件': 'Local files',
  '每天 03:00 自动打一个包，落在': 'A package is built automatically every day at 03:00 and stored in',
  '，保留最近 14 份。': ', keeping the latest 14.',
  '包里是库快照 + 当天观测心跳（CSV）+ 配置 + 密钥文件，恢复时整包解开即可。':
    'The package holds a database snapshot + the monitor heartbeats of that day (CSV) + config + the key file; to restore, just unpack the whole thing.',
  '份': (v) => (Number(v.n) === 1 ? 'copy' : 'copies'),
  '上次 {time}': 'Last {time}',
  '成功 · {detail}': 'Success · {detail}',
  '失败 · {detail}': 'Failed · {detail}',
  '备份中…': 'Backing up…',
  '立即备份': 'Back up now',
  '文件': 'File',
  '大小': 'Size',
  '下载': 'Download',
  '清单': 'Manifest',
  '还没有备份文件': 'No backup files yet',
  '包内容 · {time}': 'Contents · {time}',
  '收起': 'Collapse',
  '已完成：{detail}': 'Done: {detail}',
  '失败：{detail}': 'Failed: {detail}',
  '没有可用的目的地': 'No destination available',
  '删掉这份备份？不可恢复。': 'Delete this backup? It cannot be undone.',

  // 远程数据库
  '连接成功：{version}': 'Connected: {version}',
  '连接失败': 'Connection failed',
  '断开远程库？已上传的备份不会删。': 'Disconnect the remote database? Uploaded backups are not deleted.',
  '删掉远端这份备份？': 'Delete this remote backup?',
  '已下载到本机：{file}（{size}），在上面的列表里能看到':
    'Downloaded to this machine: {file} ({size}), it now shows up in the list above',
  '远程数据库': 'Remote database',
  '把同一份备份再写一行到 MySQL / PostgreSQL，换机、换盘都不怕。密码加密后存在本机库里，页面上只显示「已设置」。':
    'Writes the same backup as a row into MySQL / PostgreSQL, so switching machines or disks is no problem. The password is encrypted and stored in the local database; the page only shows "set".',
  '表 {table} · 密码已设置': 'Table {table} · password set',
  '立即上传': 'Upload now',
  '改配置': 'Edit config',
  '断开': 'Disconnect',
  '上传时间': 'Uploaded',
  '取回': 'Fetch',
  '远端还没有备份': 'No remote backups yet',
  '库名': 'Database',
  '表名': 'Table name',
  '留空 = 沿用已存的密码': 'Leave blank to keep the stored password',
}
