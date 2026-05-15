import api from './client'
import type {
  PreprocessTask,
  PreprocessStatistics,
  SystemLoadInfo,
  PreprocessStorageUsage,
  CacheUsage,
  PreprocessFilter,
  PreprocessFilterPreview,
  PreprocessCandidateList,
} from '@/types'

// 候选列表查询参数（前端 → 后端）
export interface PreprocessCandidatesQuery {
  page?: number
  size?: number
  keyword?: string
  library_id?: string
  media_type?: string
  video_codec?: string
  only_need_preprocess?: boolean
  sort_by?: 'updated_at' | 'file_size' | 'duration' | 'year'
  sort_order?: 'asc' | 'desc'
}

// ==================== 视频预处理 ====================
export const preprocessApi = {
  // 提交单个媒体预处理
  // force=true 可绕过"可直接播放则跳过"的自动判定（用户强制预处理场景）
  submit: (mediaId: string, priority?: number, force?: boolean) =>
    api.post<{ message: string; data: PreprocessTask }>('/admin/preprocess/submit', {
      media_id: mediaId,
      priority: priority || 0,
      force: force === true,
    }),

  // 批量提交预处理
  // force=true 可绕过"可直接播放则跳过"的自动判定
  batchSubmit: (mediaIds: string[], priority?: number, force?: boolean) =>
    api.post<{ message: string; data: { submitted: number; tasks: PreprocessTask[] } }>(
      '/admin/preprocess/batch',
      { media_ids: mediaIds, priority: priority || 0, force: force === true }
    ),

  // 提交整个媒体库预处理
  submitLibrary: (libraryId: string, priority?: number) =>
    api.post<{ message: string; data: { submitted: number } }>(
      `/admin/preprocess/library/${libraryId}`,
      { priority: priority || 0 }
    ),

  // 获取任务列表
  listTasks: (page?: number, pageSize?: number, status?: string) =>
    api.get<{ data: { tasks: PreprocessTask[]; total: number; page: number; page_size: number } }>(
      '/admin/preprocess/tasks',
      { params: { page: page || 1, page_size: pageSize || 20, status: status || '' } }
    ),

  // 获取任务详情
  getTask: (taskId: string) =>
    api.get<{ data: PreprocessTask }>(`/admin/preprocess/tasks/${taskId}`),

  // 获取媒体的预处理状态
  getMediaStatus: (mediaId: string) =>
    api.get<{ data: PreprocessTask }>(`/preprocess/media/${mediaId}/status`),

  // 暂停任务
  pauseTask: (taskId: string) =>
    api.post(`/admin/preprocess/tasks/${taskId}/pause`),

  // 恢复任务
  resumeTask: (taskId: string) =>
    api.post(`/admin/preprocess/tasks/${taskId}/resume`),

  // 取消任务
  cancelTask: (taskId: string) =>
    api.post(`/admin/preprocess/tasks/${taskId}/cancel`),

  // 重试任务
  retryTask: (taskId: string) =>
    api.post(`/admin/preprocess/tasks/${taskId}/retry`),

  // 删除任务
  deleteTask: (taskId: string) =>
    api.delete(`/admin/preprocess/tasks/${taskId}`),

  // 批量删除任务
  batchDeleteTasks: (taskIds: string[]) =>
    api.post<{ message: string; data: { deleted: number } }>('/admin/preprocess/tasks/batch-delete', { task_ids: taskIds }),

  // 批量取消任务
  batchCancelTasks: (taskIds: string[]) =>
    api.post<{ message: string; data: { cancelled: number } }>('/admin/preprocess/tasks/batch-cancel', { task_ids: taskIds }),

  // 批量重试任务
  batchRetryTasks: (taskIds: string[]) =>
    api.post<{ message: string; data: { retried: number } }>('/admin/preprocess/tasks/batch-retry', { task_ids: taskIds }),

  // 获取统计信息
  getStatistics: () =>
    api.get<{ data: PreprocessStatistics }>('/admin/preprocess/statistics'),

  // 获取系统负载
  getSystemLoad: () =>
    api.get<{ data: SystemLoadInfo }>('/admin/preprocess/system-load'),

  // 清理预处理缓存
  cleanCache: (mediaId: string) =>
    api.delete(`/admin/preprocess/cache/${mediaId}`),

  // 查询预处理产物的磁盘占用
  // limit: 返回明细条数（默认 20，最大 200，0=不限）
  getStorageUsage: (limit?: number) =>
    api.get<{ data: PreprocessStorageUsage }>('/admin/preprocess/storage-usage', {
      params: { limit: limit ?? 20 },
    }),

  // 一键清理所有孤儿预处理目录（DB 中无对应任务的物理目录）
  cleanOrphanCache: () =>
    api.post<{ message: string; data: { cleaned: number; freed_bytes: number } }>(
      '/admin/preprocess/clean-orphan'
    ),

  // 整个 cache/ 目录的分类占用（preprocess + transcode + thumbnails + ...）
  // force=true 跳过 30s 内存缓存，强制重新扫盘
  getCacheUsage: (force?: boolean) =>
    api.get<{ data: CacheUsage }>('/admin/cache/usage', {
      params: force ? { force: 1 } : {},
    }),

  // 手动清理单个分类
  // - preprocess + mode='all'（默认）：清所有非 running 任务的产物，并把任务重置为 pending
  // - preprocess + mode='orphan'：只清孤儿目录（数据库无对应任务记录）
  // - 其它 cleanable 分类：整目录清空
  cleanCacheCategory: (key: string, mode: 'all' | 'orphan' = 'all') =>
    api.post<{
      message: string
      data: {
        key: string
        label: string
        freed_bytes: number
        freed_count: number
        skipped?: boolean
        skipped_note?: string
      }
    }>('/admin/cache/clean', null, { params: { key, mode } }),

  // 一键清理所有可清分类
  cleanAllCache: () =>
    api.post<{
      message: string
      data: {
        results: Array<{
          key: string
          label: string
          freed_bytes: number
          freed_count: number
          skipped?: boolean
          skipped_note?: string
        }>
        total_freed: number
        total_count: number
        category_num: number
      }
    }>('/admin/cache/clean-all'),

  // 自定义筛选 - 预览（仅统计，不入队）
  previewByFilter: (filter: PreprocessFilter) =>
    api.post<{ data: PreprocessFilterPreview }>(
      '/admin/preprocess/filter-preview',
      buildFilterRequestBody(filter)
    ),

  // 自定义筛选 - 提交（按筛选条件批量入队）
  submitByFilter: (filter: PreprocessFilter, priority = 0, force = false) =>
    api.post<{ message: string; data: { submitted: number; skipped: number } }>(
      '/admin/preprocess/submit-by-filter',
      { ...buildFilterRequestBody(filter), priority, force }
    ),

  // 候选影视列表 - 供用户手动勾选预处理
  listCandidates: (query: PreprocessCandidatesQuery = {}) =>
    api.get<{ data: PreprocessCandidateList }>(
      '/admin/preprocess/candidates',
      {
        params: {
          page: query.page ?? 1,
          size: query.size ?? 20,
          keyword: query.keyword ?? '',
          library_id: query.library_id ?? '',
          media_type: query.media_type ?? '',
          video_codec: query.video_codec ?? '',
          only_need_preprocess: query.only_need_preprocess ? 'true' : 'false',
          sort_by: query.sort_by ?? 'updated_at',
          sort_order: query.sort_order ?? 'desc',
        },
      }
    ),
}

// 把前端的 PreprocessFilter 翻译成后端期望的请求体形态：
// 三个 exclude_* 是可选 boolean，用 *_ptr 字段传，后端区分"未传 vs 显式 false"。
function buildFilterRequestBody(f: PreprocessFilter): Record<string, unknown> {
  const body: Record<string, unknown> = {
    library_ids: f.library_ids ?? [],
    media_types: f.media_types ?? [],
    video_codecs: f.video_codecs ?? [],
    audio_codecs: f.audio_codecs ?? [],
    containers: f.containers ?? [],
    resolutions: f.resolutions ?? [],
    keyword: f.keyword ?? '',
    min_size_bytes: f.min_size_bytes ?? 0,
    max_size_bytes: f.max_size_bytes ?? 0,
    min_year: f.min_year ?? 0,
    max_year: f.max_year ?? 0,
    min_duration: f.min_duration ?? 0,
    max_duration: f.max_duration ?? 0,
  }
  if (f.exclude_already_preprocessed !== undefined) {
    body.exclude_already_preprocessed_ptr = f.exclude_already_preprocessed
  }
  if (f.exclude_directly_playable !== undefined) {
    body.exclude_directly_playable_ptr = f.exclude_directly_playable
  }
  if (f.exclude_strm !== undefined) {
    body.exclude_strm_ptr = f.exclude_strm
  }
  return body
}
