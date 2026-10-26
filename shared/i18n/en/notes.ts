// 便签页（列表、卡片、输入框、筛选行、图片上传）。
import type { Dict } from '../core'

export const notes: Dict = {
  // 空态
  '没有匹配的归档便签': 'No archived notes match',
  '还没有归档的便签': 'No archived notes yet',
  '没有匹配的便签': 'No notes match',
  '还没有便签': 'No notes yet',
  '换个关键词试试。': 'Try a different keyword.',
  '点便签右上角的「归档」把用不着的收起来；归档后默认不显示，只在这里看得到。':
    'Use “Archive” in a note’s top-right corner to put it away; archived notes are hidden by default and only show up here.',
  '换个关键词，或清掉筛选条件。': 'Try another keyword, or clear the filters.',
  '在上面写第一条。用 #标签 归类，点 📌 置顶，点左边的圆圈标记完成。':
    'Write your first note above. Use #tags to group them, 📌 to pin, and the circle on the left to mark it done.',

  // 列表分区 / 筛选行
  '已归档 · 只读': 'Archived · read-only',
  '置顶': 'Pinned',
  '未完成': 'Open',
  '已完成': 'Done',
  '已归档': 'Archived',
  '新标签': 'New tag',
  '新建一个标签': 'Create a tag',
  '搜索便签': 'Search notes',
  '归档的便签默认不显示；在这里查看、恢复或永久删除':
    'Archived notes are hidden by default; view, restore or delete them here',

  // 卡片
  '已归档（只读）': 'Archived (read-only)',
  '双击取消完成': 'Double-click to mark as not done',
  '双击标记完成': 'Double-click to mark as done',
  '标记为未完成': 'Mark as not done',
  '标记为已完成': 'Mark as done',
  '· 已编辑': '· edited',
  '恢复': 'Restore',
  '永久删除': 'Delete permanently',
  '取消置顶': 'Unpin',
  '归档': 'Archive',
  '打开关联资产': 'Open linked asset',

  // 输入框
  '记点什么…  用 #标签 自动归类，Ctrl/⌘ + Enter 保存；图片可以直接粘贴或拖进来':
    'Jot something down…  use #tags to file it, Ctrl/⌘ + Enter to save; images can be pasted or dropped in',
  '松手就上传图片': 'Drop to upload the image',
  '置顶这条便签': 'Pin this note',
  '从已有标签里挑一个插进便签': 'Pick an existing tag to insert into the note',
  '标签': 'Tag',
  '点一下插进便签': 'Click to insert into the note',
  '还没有标签': 'No tags yet',
  '新建标签…': 'New tag…',
  '插入图片（也可以直接粘贴或拖进来）': 'Insert an image (you can also paste or drag one in)',
  '上传中…': 'Uploading…',
  '图片': 'Image',
  'Ctrl/⌘ + Enter 保存': 'Ctrl/⌘ + Enter to save',
  '记下': 'Add note',
  '也可以直接手打': 'You can also type',

  // 新建标签弹层
  '新建标签': 'New tag',
  '创建': 'Create',
  '例如：待办': 'e.g. To do',
  '创建后会直接插到便签里；也可以只在设置页管理。':
    'It is inserted into the note right away; you can also manage tags only on the settings page.',

  // 确认与图片上传报错
  '永久删除这条便签？不可恢复。': 'Delete this note permanently? This cannot be undone.',
  '只能插入 PNG / JPEG / WebP / GIF 图片': 'Only PNG / JPEG / WebP / GIF images can be inserted',
  '图片上传失败：{msg}': 'Image upload failed: {msg}',
  '图片上传失败': 'Image upload failed',
}
