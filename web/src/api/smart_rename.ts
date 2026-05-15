import api from './client'

// =====================================
// SmartRename · 智能扫描重命名 API
// =====================================
//
// 该模块对接后端 /api/admin/smart-rename/* 系列接口：
//   - 默认 dry-run：execute 接口必须显式传 confirm=true 才会真正落盘
//   - 支持 plan + journal 双写，提供回滚 API
//   - 命名风格默认 Jellyfin/Emby [tmdbid-xxx]，可切 Plex {tmdb-xxx}

// ---------- 类型 ----------

export type RenamePlanStatus =
  | 'draft'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'rolledback'
  | 'canceled'

export type RenameItemStatus =
  | 'pending'
  | 'skipped'
  | 'unsafe'
  | 'executed'
  | 'failed'
  | 'reverted'

export type NamingStyle = 'jellyfin' | 'plex'

export interface SafetyReport {
  ok: boolean
  cross_volume: boolean
  target_exists: boolean
  hardlink_count: number
  outside_safe_root: boolean
  not_enough_space: boolean
  issues: string[]
}

export interface RelatedFile {
  source: string
  target: string
  kind: 'nfo' | 'subtitle' | 'poster' | 'fanart' | 'thumb' | 'banner' | 'clearlogo' | 'landscape' | 'disc' | 'image' | 'other'
}

export interface RenamePlanItem {
  id: string
  plan_id: string
  media_id: string
  source_path: string
  source_name: string
  target_path: string
  target_name: string
  need_mkdir: boolean
  parsed_title: string
  parsed_title_alt: string
  parsed_year: number
  parsed_tmdb_id: number
  parsed_imdb_id: string
  media_type: 'movie' | 'episode' | 'unknown' | ''
  season_num: number
  episode_num: number
  confidence: number
  ai_invoked: boolean
  ai_raw_response: string
  related_files_json: string
  safety_json: string
  safety_ok: boolean
  safety_note: string
  status: RenameItemStatus
  error_msg: string
  override_name: string
  excluded: boolean
  created_at: string
  updated_at: string
}

export interface RenamePlan {
  id: string
  library_id: string
  root_path: string
  naming_style: NamingStyle
  template: string
  enable_ai_fallback: boolean
  ai_confidence_threshold: number
  status: RenamePlanStatus
  dry_run: boolean
  total_items: number
  need_rename: number
  skipped_items: number
  unsafe_items: number
  executed_items: number
  failed_items: number
  ai_invocations: number
  created_by: string
  created_at: string
  updated_at: string
  executed_at: string | null
  completed_at: string | null
  items?: RenamePlanItem[]
}

export interface ScanRequest {
  root_path: string
  library_id?: string
  naming_style?: NamingStyle
  template?: string
  enable_ai_fallback?: boolean
  ai_confidence_threshold?: number
  safe_roots?: string[]
}

export interface ExecuteRequest {
  plan_id: string
  confirm: boolean
  item_ids?: string[]
  ignore_safety?: boolean
}

// ---------- API ----------

export const smartRenameApi = {
  scan: (req: ScanRequest) =>
    api.post<{ data: RenamePlan }>('/admin/smart-rename/scan', req),

  // 默认 dry-run；confirm=true 才真正落盘
  execute: (req: ExecuteRequest) =>
    api.post<{ data: RenamePlan; dry_run: boolean }>('/admin/smart-rename/execute', req),

  rollback: (planId: string) =>
    api.post<{ data: RenamePlan }>(`/admin/smart-rename/rollback/${planId}`),

  cancel: (planId: string) =>
    api.post<{ message: string }>(`/admin/smart-rename/cancel/${planId}`),

  listPlans: (page = 1, size = 20) =>
    api.get<{ data: { items: RenamePlan[]; total: number; page: number; size: number } }>(
      '/admin/smart-rename/plans',
      { params: { page, size } },
    ),

  getPlan: (planId: string) =>
    api.get<{ data: RenamePlan }>(`/admin/smart-rename/plans/${planId}`),

  deletePlan: (planId: string) =>
    api.delete<{ message: string }>(`/admin/smart-rename/plans/${planId}`),

  updateItem: (itemId: string, body: { override_name?: string; excluded?: boolean }) =>
    api.put<{ data: RenamePlanItem }>(`/admin/smart-rename/items/${itemId}`, body),
}

// 解析 item 上的 related_files_json
export function parseRelatedFiles(item: RenamePlanItem): RelatedFile[] {
  if (!item.related_files_json) return []
  try {
    const arr = JSON.parse(item.related_files_json)
    return Array.isArray(arr) ? (arr as RelatedFile[]) : []
  } catch {
    return []
  }
}

// 解析 item 上的 safety_json
export function parseSafety(item: RenamePlanItem): SafetyReport | null {
  if (!item.safety_json) return null
  try {
    const r = JSON.parse(item.safety_json) as SafetyReport
    // 兼容后端 Go 把空切片序列化为 null 的情况
    if (!Array.isArray(r.issues)) {
      r.issues = []
    }
    return r
  } catch {
    return null
  }
}
