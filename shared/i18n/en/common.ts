import type { Dict } from '../core'

// 各页共用的按钮、字段名、状态词。页面专属的放各自的文件里。
// 同一个中文原文只该有一份译文；重复了以页面文件为准（en/index.ts 的合并顺序）。
export const common: Dict = {
  '保存': 'Save',
  '取消': 'Cancel',
  '删除': 'Delete',
  '关闭': 'Close',
  '确定': 'OK',
  '编辑': 'Edit',
  '新建': 'New',
  '刷新': 'Refresh',
  '重试': 'Retry',
  '搜索': 'Search',
  '名称': 'Name',
  '颜色': 'Color',
  '备注': 'Notes',
  '加载中…': 'Loading…',
  '复制': 'Copy',
  '已复制': 'Copied',
  '全部': 'All',
  '暂无': 'None',
}
