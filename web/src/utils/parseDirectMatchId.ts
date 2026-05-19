// parseDirectMatchId.ts
// ------------------------------------------------------------
// 手动匹配输入框增强：支持用户直接粘贴 ID 或完整 URL
//
// 兼容形式（任一 source 下）：
//   TMDb：
//     - 128881
//     - 128881-3                 // 带 collection 后缀，取首段数字
//     - https://www.themoviedb.org/movie/128881-3
//     - https://www.themoviedb.org/tv/1399
//     - themoviedb.org/movie/128881
//   豆瓣：
//     - https://movie.douban.com/subject/26794435/
//     - douban.com/subject/26794435
//     - 26794435   （纯数字，仅当 source=douban 时按 ID 处理）
//   Bangumi（bgm.tv）：
//     - https://bgm.tv/subject/302513
//     - bangumi.tv/subject/302513
//     - 302513   （纯数字，仅当 source=bangumi 时按 ID 处理）
//   TheTVDB：
//     - https://www.thetvdb.com/series/xxx       // slug，无法直绑
//     - https://thetvdb.com/?tab=series&id=12345 // 兼容旧版
//     - 12345   （纯数字，仅当 source=thetvdb 时按 ID 处理）
// ------------------------------------------------------------

export type MatchSource = 'tmdb' | 'douban' | 'bangumi' | 'thetvdb'

export interface DirectMatchHit {
  /** 匹配到的最终 ID（TMDb / TheTVDB / Bangumi 为数字 string，可被 Number()；豆瓣保持字符串） */
  id: string
  /** 原始来源 */
  source: MatchSource
  /** 仅 TMDb：如果 URL 里能判断出 movie/tv，会回传，便于 mediaType 校正 */
  tmdbMediaType?: 'movie' | 'tv'
}

/**
 * 解析输入：如果识别到 ID 或 URL，返回 hit；否则返回 null（按原关键词搜索流程走）。
 *
 * @param raw    用户输入框内容
 * @param source 当前激活的数据源 tab
 */
export function parseDirectMatchId(raw: string, source: MatchSource): DirectMatchHit | null {
  const text = (raw || '').trim()
  if (!text) return null

  // ---- 1. URL 优先级最高：从 URL 中识别来源（不强依赖当前 tab） ----
  const lower = text.toLowerCase()

  // TMDb URL: themoviedb.org/{movie|tv}/{id}[-slug]
  // 例：https://www.themoviedb.org/movie/128881-3
  const tmdbUrlMatch = lower.match(/themoviedb\.org\/(movie|tv)\/(\d+)/)
  if (tmdbUrlMatch) {
    return {
      id: tmdbUrlMatch[2],
      source: 'tmdb',
      tmdbMediaType: tmdbUrlMatch[1] as 'movie' | 'tv',
    }
  }

  // 豆瓣 URL: douban.com/subject/{id}
  const doubanUrlMatch = lower.match(/douban\.com\/subject\/(\d+)/)
  if (doubanUrlMatch) {
    return { id: doubanUrlMatch[1], source: 'douban' }
  }

  // Bangumi URL: bgm.tv|bangumi.tv /subject/{id}
  const bgmUrlMatch = lower.match(/(?:bgm|bangumi)\.tv\/subject\/(\d+)/)
  if (bgmUrlMatch) {
    return { id: bgmUrlMatch[1], source: 'bangumi' }
  }

  // TheTVDB URL（仅数字 id 形式可解析；slug 形式无法解析）
  const tvdbUrlMatch = lower.match(/thetvdb\.com\/(?:.*?[?&]id=|series\/)(\d+)/)
  if (tvdbUrlMatch) {
    return { id: tvdbUrlMatch[1], source: 'thetvdb' }
  }

  // ---- 2. 非 URL：按当前 tab 解析 ----
  // TMDb 允许 "128881" 或 "128881-3"
  if (source === 'tmdb') {
    const m = text.match(/^(\d+)(?:-\d+)?$/)
    if (m) return { id: m[1], source: 'tmdb' }
    return null
  }

  // 其余三家：纯数字才算 ID
  if (/^\d+$/.test(text)) {
    return { id: text, source }
  }
  return null
}
