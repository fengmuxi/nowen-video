// invalidateMediaCaches.ts
// ------------------------------------------------------------
// 媒体内容变更后的统一缓存失效入口
//
// 适用场景：
//   - 手动匹配元数据 / 取消匹配 / 刷新元数据 / 编辑元数据 成功后
//   - 删除媒体（虽然会跳走，但保险起见）
//
// 为什么需要：
//   首页 (HomePage)、浏览页 (BrowsePage)、合集页 (CollectionsPage)、
//   收藏页 (FavoritesPage)、历史页 (HistoryPage) 都使用 usePageCache
//   做了内存缓存（TTL 15~30s）。如果只刷新详情页本地数据而不通知列表缓存，
//   用户返回桌面/列表会看到 30s 内的旧数据，必须刷新整个页面才生效。
//
// 调用时机：
//   仅在「成功」分支调用，失败/取消不调用。
// ------------------------------------------------------------

import { invalidatePageCachePrefix } from '@/hooks/usePageCache'

/**
 * 失效所有可能展示该媒体/剧集的列表页缓存。
 * 下次进入对应页面时会自动重新拉取最新数据。
 */
export function invalidateMediaListCaches() {
  // 首页（最近添加 / 推荐 / 继续观看）
  invalidatePageCachePrefix('home:')
  // 浏览页（按分类/筛选）
  invalidatePageCachePrefix('browse:')
  // 合集页
  invalidatePageCachePrefix('collections:')
  // 收藏页
  invalidatePageCachePrefix('favorites:')
  // 历史页（媒体标题/海报路径会展示在历史里）
  invalidatePageCachePrefix('history:')
}
