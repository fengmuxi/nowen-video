import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  scanClassifyApi,
  type MediaClassification,
  type ClassificationStats,
  type ClassificationCategory,
  categoryDisplay,
  regionDisplay,
  statusDisplay,
  statusColor,
  categoryToEmbyCollectionType,
  categoryToEmbyGenre,
  embyCollectionTypeDisplay,
  type EmbyCollectionType,
} from '@/api/scanClassify'
import { libraryApi, aiApi } from '@/api'
import type { Library } from '@/types'
import {
  RefreshCw,
  Sparkles,
  Search,
  Loader2,
  Database,
  CheckCircle2,
  AlertTriangle,
  Bot,
  Trash2,
  Settings2,
  X,
  RotateCw,
  Pencil,
  Keyboard,
  Zap,
  ChevronDown,
  Wand2,
  StopCircle,
} from 'lucide-react'
import clsx from 'clsx'
import { useDialog } from '@/components/Dialog'
import SmartRenameDrawer from '@/components/SmartRenameDrawer'

// ==================== 智能归类（原"扫描后处理 / 虚拟归类与命名映射"） ====================
//
// 三阶段产出（仅写数据库，绝不修改任何磁盘文件）：
//   1. AI 智能识别  - 标题/年份/TMDb ID + 匹配度
//   2. 智能分类     - 类别/地区/年代/类型标签/质量档/虚拟路径
//   3. 建议名称     - Jellyfin/Emby 风格命名建议
//
// 傻瓜化设计原则：
//   - 头部行动召唤区一键可达
//   - 统计卡可点击直接筛选
//   - 默认置顶展示「待修正」让用户首屏即看到问题
//   - AI 未配置时给出明确引导
//   - 提供小白模式（默认）与专家模式切换

// ============ 常量 ============

const CATEGORY_OPTIONS: { value: ClassificationCategory | ''; label: string }[] = [
  { value: '', label: '全部类别' },
  { value: 'movie', label: '电影  ·  Movies' },
  { value: 'tvshow', label: '剧集  ·  TV Shows' },
  { value: 'anime', label: '动画  ·  TV Shows / Genre=Anime' },
  { value: 'documentary', label: '纪录片  ·  TV Shows / Genre=Documentary' },
  { value: 'variety', label: '综艺  ·  TV Shows / Genre=Reality' },
  { value: 'music', label: '音乐  ·  Music' },
  { value: 'adult', label: '成人  ·  Mixed' },
  { value: 'other', label: '其他  ·  Mixed' },
]

const REGION_OPTIONS = [
  { value: '', label: '全部地区' },
  { value: 'CN', label: '中国大陆' },
  { value: 'HK', label: '中国香港' },
  { value: 'TW', label: '中国台湾' },
  { value: 'JP', label: '日本' },
  { value: 'KR', label: '韩国' },
  { value: 'US', label: '美国' },
  { value: 'EU', label: '欧洲' },
  { value: 'IN', label: '印度' },
  { value: 'OTHER', label: '其他' },
]

// 快捷筛选标签：4 个核心场景
type QuickFilter = 'all' | 'todo' | 'done' | 'ai'

const QUICK_TABS: { key: QuickFilter; label: string; icon: React.ReactNode; tint: string }[] = [
  { key: 'all', label: '全部', icon: <Database className="h-4 w-4" />, tint: 'text-blue-300' },
  { key: 'todo', label: '⚠️ 待修正', icon: <AlertTriangle className="h-4 w-4" />, tint: 'text-red-300' },
  { key: 'done', label: '已完成', icon: <CheckCircle2 className="h-4 w-4" />, tint: 'text-emerald-300' },
  { key: 'ai', label: 'AI 识别', icon: <Bot className="h-4 w-4" />, tint: 'text-purple-300' },
]

// ============ 主组件 ============

export default function ClassificationTab() {
  const dialog = useDialog()

  // ---------- 状态 ----------
  const [libraries, setLibraries] = useState<Library[]>([])
  const [libraryID, setLibraryID] = useState<string>('')

  // 快捷筛选优先；高级筛选可展开
  const [quick, setQuick] = useState<QuickFilter>('todo') // 默认置顶「待修正」
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [category, setCategory] = useState<ClassificationCategory | ''>('')
  const [region, setRegion] = useState<string>('')
  const [keywordInput, setKeywordInput] = useState<string>('')
  const [keyword, setKeyword] = useState<string>('')

  // 模式切换：小白模式 vs 专家模式
  const [expertMode, setExpertMode] = useState<boolean>(() => {
    return localStorage.getItem('classify-expert-mode') === 'true'
  })

  // 列表 / 分页
  // 每页条数：支持 20 / 30 / 50 / 100 / 200，并通过 localStorage 持久化用户偏好
  const PAGE_SIZE_OPTIONS = [20, 30, 50, 100, 200] as const
  const [page, setPage] = useState(1)
  const [size, setSize] = useState<number>(() => {
    const raw = localStorage.getItem('classify-page-size')
    const n = raw ? parseInt(raw, 10) : 30
    return PAGE_SIZE_OPTIONS.includes(n as (typeof PAGE_SIZE_OPTIONS)[number]) ? n : 30
  })
  const [items, setItems] = useState<MediaClassification[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // 统计
  const [stats, setStats] = useState<ClassificationStats | null>(null)

  // AI 状态（用于引导）
  const [aiReady, setAiReady] = useState<boolean | null>(null)

  // 操作状态
  const [reprocessing, setReprocessing] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [progress, setProgress] = useState<{
    running: boolean
    queued: number
    startedAt: number
  } | null>(null)
  const [message, setMessage] = useState<{ type: 'ok' | 'err' | 'info'; text: string } | null>(null)

  // 修正弹层
  const [correctTarget, setCorrectTarget] = useState<MediaClassification | null>(null)

  // 快捷键帮助
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false)

  // 首次访问引导
  const [tourSeen, setTourSeen] = useState<boolean>(() => {
    return localStorage.getItem('classify-tour-seen') === '1'
  })

  // 设置抽屉（收纳：专家模式 / 危险区 / 键盘快捷键 / 删除归类记录）
  const [settingsOpen, setSettingsOpen] = useState(false)

  // 首次向导（A+C 模式）：当从未跑过 + 未关闭过引导 时显示
  const [wizardDismissed, setWizardDismissed] = useState<boolean>(() => {
    return localStorage.getItem('classify-wizard-dismissed') === '1'
  })

  // 跑完后自动切到 todo 的标志
  const [pendingAutoSwitchTodo, setPendingAutoSwitchTodo] = useState(false)

  // 专家动作：应用建议名称到磁盘（智能重命名抽屉）
  // Phase 2：将原独立入口收敛到扫描归类专家模式
  const [renameDrawerOpen, setRenameDrawerOpen] = useState(false)

  // 当前用户在搜索框内
  const searchRef = useRef<HTMLInputElement | null>(null)

  // ---------- 派生 ----------
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / size)), [total, size])

  // 把"快捷筛选"映射成实际请求参数
  const computeListParams = useCallback(() => {
    const base: Record<string, unknown> = {
      library_id: libraryID || undefined,
      keyword: keyword || undefined,
      page,
      size,
    }
    if (expertMode) {
      base.category = category || undefined
      base.region = region || undefined
    }
    switch (quick) {
      case 'todo':
        // 「待修正」= failed + partial（前端发两次请求合并代价过高，先按 failed 优先；专家模式可在高级筛选里手选 partial）
        base.status = 'failed'
        break
      case 'done':
        base.status = 'processed'
        break
      case 'ai':
        // 「AI 识别」目前没有专属字段索引，先按 processed 取，再前端过滤 ai_invoked
        base.status = 'processed'
        break
      case 'all':
      default:
        break
    }
    return base
  }, [libraryID, keyword, page, size, expertMode, category, region, quick])

  // ---------- 数据加载 ----------
  const loadLibraries = useCallback(async () => {
    try {
      const res = await libraryApi.list()
      setLibraries(res.data.data || [])
    } catch {
      /* 静默 */
    }
  }, [])

  const loadStats = useCallback(async () => {
    try {
      const res = await scanClassifyApi.stats(libraryID || undefined)
      setStats(res.data.data)
    } catch {
      /* 静默 */
    }
  }, [libraryID])

  const loadAIStatus = useCallback(async () => {
    try {
      const res = await aiApi.getStatus()
      const st = res.data.data as unknown as {
        api_configured?: boolean
        enabled?: boolean
        auto_pilot?: boolean
      }
      setAiReady(Boolean(st?.api_configured && (st?.enabled || st?.auto_pilot)))
    } catch {
      setAiReady(false)
    }
  }, [])

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const res = await scanClassifyApi.list(computeListParams())
      let arr = res.data.data.items || []
      // 「AI 识别」标签：前端二次过滤
      if (quick === 'ai') {
        arr = arr.filter((it) => it.ai_invoked)
      }
      setItems(arr)
      setTotal(res.data.data.total || 0)
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } }
      setMessage({ type: 'err', text: err?.response?.data?.error || '加载失败' })
    } finally {
      setLoading(false)
    }
  }, [computeListParams, quick])

  useEffect(() => {
    loadLibraries()
    loadAIStatus()
  }, [loadLibraries, loadAIStatus])

  useEffect(() => {
    loadList()
  }, [loadList])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  // 搜索防抖
  useEffect(() => {
    const t = setTimeout(() => {
      setKeyword(keywordInput.trim())
      setPage(1)
    }, 400)
    return () => clearTimeout(t)
  }, [keywordInput])

  // 异步进度轮询（粗略估算）：进入 progress 状态后每 2s 刷一次列表 + 统计，持续 90s
  useEffect(() => {
    if (!progress?.running) return
    const startedAt = progress.startedAt
    const interval = setInterval(() => {
      const elapsed = Date.now() - startedAt
      // 90s 后强制结束（用户想再看进度可手动刷新）
      if (elapsed > 90_000) {
        setProgress(null)
        clearInterval(interval)
        // 完成后自动切到 todo（如果有失败）
        if (pendingAutoSwitchTodo) {
          setPendingAutoSwitchTodo(false)
          setTimeout(() => {
            setQuick((cur) => {
              // 仅当用户没主动切换过时才自动切到 todo
              return cur
            })
            // 通过最新 stats 决定提示文案
            scanClassifyApi
              .stats(libraryID || undefined)
              .then((r) => {
                const s = r.data.data
                const failed =
                  (s?.by_status?.find((x) => x.key === 'failed')?.count || 0) +
                  (s?.by_status?.find((x) => x.key === 'partial')?.count || 0)
                if (failed > 0) {
                  setQuick('todo')
                  setMessage({
                    type: 'info',
                    text: `✨ 归类完成！有 ${failed} 条建议你确认一下，已为你切到「待修正」`,
                  })
                } else {
                  setQuick('done')
                  setMessage({
                    type: 'ok',
                    text: '🎉 归类完成，全部就绪，无需人工处理！',
                  })
                }
              })
              .catch(() => {})
          }, 0)
        }
        return
      }
      loadList()
      loadStats()
    }, 2500)
    return () => clearInterval(interval)
  }, [progress, loadList, loadStats, pendingAutoSwitchTodo, libraryID])

  // 切库 / 切快捷标签 → page 重置
  useEffect(() => {
    setPage(1)
  }, [libraryID, quick, category, region])

  // 持久化模式
  useEffect(() => {
    localStorage.setItem('classify-expert-mode', expertMode ? 'true' : 'false')
  }, [expertMode])

  // 持久化每页条数
  useEffect(() => {
    localStorage.setItem('classify-page-size', String(size))
  }, [size])

  // 快捷键
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // 焦点在输入框时除 ESC 外不响应快捷键
      const target = e.target as HTMLElement | null
      const inField =
        !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (e.key === 'Escape') {
        setCorrectTarget(null)
        setShortcutHelpOpen(false)
        setExpandedId(null)
        return
      }
      if (inField) return
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        setShortcutHelpOpen((v) => !v)
        return
      }
      if (e.key === 'r' || e.key === 'R') {
        handleReprocess()
        return
      }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (e.key === '1') setQuick('all')
      else if (e.key === '2') setQuick('todo')
      else if (e.key === '3') setQuick('done')
      else if (e.key === '4') setQuick('ai')
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryID])

  // ---------- 操作 ----------

  // 一键智能归类：未选库 = 全部媒体库，已选库 = 该库
  // 傻瓜化：AI 未配置时按钮直接 disabled，不再弹窗让用户选
  const handleReprocess = async () => {
    if (reprocessing) return
    // AI 未配置：禁止启动，直接引导去配置（按钮也是 disabled）
    if (aiReady === false) {
      setMessage({
        type: 'err',
        text: '请先配置 AI 后再使用智能归类。点击右上「立即配置 AI」前往。',
      })
      return
    }

    setReprocessing(true)
    setMessage(null)
    try {
      const res = await scanClassifyApi.reprocess({
        library_id: libraryID || undefined,
        async: true,
      })
      const data = res.data.data
      const targetText = libraryID
        ? `《${libraries.find((l) => l.id === libraryID)?.name || '当前库'}》`
        : '全部媒体库'
      setMessage({
        type: 'ok',
        text: `✨ 已开始为 ${targetText} 智能归类 ${data?.count ?? 0} 条媒体，完成后会自动展示需要确认的条目`,
      })
      setProgress({ running: true, queued: data?.count ?? 0, startedAt: Date.now() })
      // 标记完成后自动切到「待修正」
      setPendingAutoSwitchTodo(true)
      // 关闭首次向导
      if (!wizardDismissed) {
        localStorage.setItem('classify-wizard-dismissed', '1')
        setWizardDismissed(true)
      }
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } }
      setMessage({ type: 'err', text: err?.response?.data?.error || '启动失败' })
    } finally {
      setReprocessing(false)
    }
  }

  // 单条重试
  const handleRetryOne = async (mediaId: string) => {
    setMessage(null)
    try {
      await scanClassifyApi.reprocess({ media_ids: [mediaId] })
      setMessage({ type: 'ok', text: '已重新识别该条' })
      loadList()
      loadStats()
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } }
      setMessage({ type: 'err', text: err?.response?.data?.error || '重试失败' })
    }
  }

  // 停止扫描归类：drain 队列 + 把 pending/running 回写为 failed
  // 仅当 progress.running 时可用；正在被 worker 处理的那一条不会强行打断（一条耗时短）
  const handleCancel = async () => {
    if (cancelling) return
    const ok = await dialog.confirm({
      title: '停止扫描归类？',
      message:
        '将立即丢弃队列中所有未处理的条目，并把待处理 / 处理中的记录回写为「失败（已取消）」。\n\n正在被处理的那一条会自然结束，不会强行打断。\n\n是否继续？',
      confirmText: '停止',
      cancelText: '继续运行',
    })
    if (!ok) return
    setCancelling(true)
    setMessage(null)
    try {
      const res = await scanClassifyApi.cancel(libraryID || undefined)
      const d = res.data.data
      setMessage({
        type: 'ok',
        text: `已停止扫描，丢弃队列 ${d.drained} 条 / 标记失败 ${d.marked} 条${d.still_running ? '（最后 1 条收尾中…）' : ''}`,
      })
      // 立刻收起进度提示并刷新列表
      setProgress(null)
      loadList()
      loadStats()
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } }
      setMessage({ type: 'err', text: err?.response?.data?.error || '停止失败' })
    } finally {
      setCancelling(false)
    }
  }

  // 清空 - 二级保险
  const handleClear = async () => {
    const label = libraryID ? '当前筛选的媒体库' : '【全部】'
    const txt = await dialog.prompt({
      title: '⚠️ 危险操作 · 删除归类记录',
      message: `即将清空 ${label} 的归类记录。此操作不可恢复。\n\n请输入 DELETE 以确认：`,
      placeholder: 'DELETE',
      confirmText: '确认清空',
    })
    if (!txt || txt.trim().toUpperCase() !== 'DELETE') {
      if (txt !== null) setMessage({ type: 'err', text: '输入不匹配，已取消' })
      return
    }
    setClearing(true)
    setMessage(null)
    try {
      const res = await scanClassifyApi.clear(libraryID || undefined)
      setMessage({ type: 'ok', text: `已清空 ${res.data.data.deleted} 条记录` })
      loadList()
      loadStats()
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } }
      setMessage({ type: 'err', text: err?.response?.data?.error || '清空失败' })
    } finally {
      setClearing(false)
    }
  }

  // 提交修正
  const handleCorrectSubmit = async (
    item: MediaClassification,
    payload: {
      title?: string
      year?: number
      tmdb_id?: number
      imdb_id?: string
      category?: string
      region?: string
    },
  ) => {
    try {
      await scanClassifyApi.correct({ media_id: item.media_id, ...payload })
      setMessage({ type: 'ok', text: `已修正：${payload.title || item.parsed_title}` })
      setCorrectTarget(null)
      loadList()
      loadStats()
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } }
      setMessage({ type: 'err', text: err?.response?.data?.error || '修正失败' })
    }
  }

  // 关闭引导
  const dismissTour = () => {
    localStorage.setItem('classify-tour-seen', '1')
    setTourSeen(true)
  }

  // ---------- 渲染 ----------
  const targetLibName = libraryID ? libraries.find((l) => l.id === libraryID)?.name : ''

  // 派生统计
  const failedCount = useMemo(() => {
    const b = stats?.by_status?.find((s) => s.key === 'failed')
    const p = stats?.by_status?.find((s) => s.key === 'partial')
    return (b?.count || 0) + (p?.count || 0)
  }, [stats])
  const doneCount = useMemo(() => {
    return stats?.by_status?.find((s) => s.key === 'processed')?.count || 0
  }, [stats])
  const aiCount = useMemo(() => {
    // 后端没有 by_ai_invoked，先用 (total - rule-only) 的近似（无 by_ai_invoked 时显示 ?）
    return null as number | null
  }, [])

  // 仿照 Emby CollectionType 聚合：业务类别 → movies/tvshows/music/mixed
  const embyDistribution = useMemo(() => {
    const buckets: Record<EmbyCollectionType, number> = {
      movies: 0,
      tvshows: 0,
      music: 0,
      photos: 0,
      mixed: 0,
      homevideos: 0,
      boxsets: 0,
    }
    ;(stats?.by_category || []).forEach((b) => {
      const ct = categoryToEmbyCollectionType[b.key] || 'mixed'
      buckets[ct] += b.count
    })
    return buckets
  }, [stats])

  return (
    <div className="space-y-5">
      {/* ============ Hero 行动召唤区（A+C 极简一键） ============ */}
      <div className="glass-panel relative overflow-hidden rounded-xl p-5">
        {/* 背景装饰 */}
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-emerald-500/5 blur-3xl" />

        <div className="relative flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary-500/15 p-2.5">
              <Sparkles className="h-5 w-5 text-primary-300" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">智能归类</h2>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                让 AI 自动识别并整理成 <span className="text-emerald-300">Emby / Jellyfin</span> 标准格式（仅写数据库，不动磁盘）
              </p>
            </div>
          </div>

          {/* 右上：仅一个「设置」入口；其余都收纳进抽屉 */}
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:border-primary-500"
            title="设置（专家模式 / 应用到磁盘 / 删除归类记录 / 快捷键）"
          >
            <Settings2 className="h-3.5 w-3.5" />
            设置
          </button>
        </div>

        {/* ========= 主操作区：库选择 + 巨型一键按钮 ========= */}
        <div className="relative mt-5 flex flex-col items-center gap-4">
          {/* 库选择行 */}
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <span>📚 媒体库</span>
            <select
              value={libraryID}
              onChange={(e) => setLibraryID(e.target.value)}
              className="rounded-md border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-primary-500 focus:outline-none"
            >
              <option value="">全部媒体库</option>
              {libraries.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            {stats && stats.total > 0 && (
              <span className="text-[var(--text-tertiary)]">
                · 共 <span className="font-semibold text-[var(--text-primary)]">{stats.total.toLocaleString()}</span> 条
              </span>
            )}
            {aiReady === true && (
              <span className="flex items-center gap-1 text-emerald-300">
                · <CheckCircle2 className="h-3 w-3" /> AI 已就绪
              </span>
            )}
            {aiReady === false && (
              <span className="flex items-center gap-1 text-amber-300">
                · <AlertTriangle className="h-3 w-3" /> AI 未配置
              </span>
            )}
          </div>

          {/* 巨型主按钮：状态机 idle / running / done */}
          {!progress?.running && !reprocessing ? (
            <button
              onClick={handleReprocess}
              disabled={aiReady === false}
              className={clsx(
                'group relative flex items-center gap-3 rounded-2xl px-8 py-4 text-base font-bold shadow-2xl transition-all',
                aiReady === false
                  ? 'cursor-not-allowed bg-[var(--bg-surface)] text-[var(--text-tertiary)]'
                  : 'bg-gradient-to-br from-primary-500 to-primary-600 text-white shadow-primary-500/30 hover:scale-[1.02] hover:shadow-primary-500/50 active:scale-[0.98]',
              )}
              title={aiReady === false ? '请先配置 AI' : '按 R 键快捷触发'}
            >
              <Zap className="h-5 w-5 group-hover:animate-pulse" />
              <span>{stats && stats.total > 0 ? '🔁 重新智能归类' : '⚡ 一键智能归类'}</span>
            </button>
          ) : (
            <div className="flex items-center gap-3 rounded-2xl border-2 border-primary-500/40 bg-primary-500/10 px-8 py-4 text-base font-bold text-primary-200">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>正在归类 {progress?.queued ?? '…'} 条…</span>
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className={clsx(
                  'ml-2 flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition',
                  cancelling
                    ? 'cursor-not-allowed bg-[var(--bg-surface)] text-[var(--text-tertiary)]'
                    : 'border border-red-500/40 bg-red-500/15 text-red-200 hover:bg-red-500/25',
                )}
              >
                {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <StopCircle className="h-3.5 w-3.5" />}
                停止
              </button>
            </div>
          )}

          {/* 一句话说明 */}
          <p className="text-center text-xs text-[var(--text-tertiary)]">
            {aiReady === false ? (
              <>
                <span className="text-amber-300">需先配置 AI</span>
                <button
                  onClick={() => (window.location.hash = '#ai')}
                  className="ml-2 rounded-md bg-amber-500/20 px-2.5 py-0.5 text-xs font-medium text-amber-100 hover:bg-amber-500/30"
                >
                  立即配置 →
                </button>
              </>
            ) : progress?.running ? (
              '页面会自动刷新进度，识别完成后自动展示需要确认的条目'
            ) : stats && stats.total > 0 ? (
              <>
                上次结果：<span className="text-emerald-300">{doneCount} 已识别</span>
                {failedCount > 0 && (
                  <>
                    {' · '}
                    <span className="text-red-300">{failedCount} 待修正</span>
                  </>
                )}
              </>
            ) : (
              '点一下，AI 会自动识别标题、年份、类别并生成 Emby/Jellyfin 命名'
            )}
          </p>
        </div>

        {/* ========= 首次向导（C：仅当未关闭过 + 还没有任何归类数据时显示） ========= */}
        {!wizardDismissed && !tourSeen && stats && stats.total === 0 && (
          <div className="relative mt-5 rounded-xl border border-blue-500/30 bg-blue-500/10 p-4 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 text-blue-200">
                <Bot className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="font-semibold text-blue-100">👋 第一次使用？三步搞定：</p>
                  <ol className="mt-2 space-y-1.5 text-xs text-blue-200/90">
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-500/30 text-[10px] font-bold text-blue-100">
                        1
                      </span>
                      <span>
                        选择要整理的媒体库
                        {aiReady === false && (
                          <span className="ml-1 text-amber-300">（同时建议配置 AI 提升识别准确率）</span>
                        )}
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-500/30 text-[10px] font-bold text-blue-100">
                        2
                      </span>
                      <span>点击上方「⚡ 一键智能归类」让 AI 开始工作</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-500/30 text-[10px] font-bold text-blue-100">
                        3
                      </span>
                      <span>完成后自动显示需要人工确认的条目，点「修改」即可调整</span>
                    </li>
                  </ol>
                </div>
              </div>
              <button
                onClick={() => {
                  localStorage.setItem('classify-wizard-dismissed', '1')
                  setWizardDismissed(true)
                  dismissTour()
                }}
                className="shrink-0 rounded-md p-1 text-blue-200 hover:bg-blue-500/20 hover:text-white"
                title="不再显示"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ============ 统计卡（可点击筛选） ============ */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <ClickableStatCard
          icon={<Database className="h-5 w-5" />}
          title="总数"
          value={stats?.total ?? 0}
          tint="text-blue-300 bg-blue-500/10"
          active={quick === 'all'}
          onClick={() => setQuick('all')}
        />
        <ClickableStatCard
          icon={<AlertTriangle className="h-5 w-5" />}
          title="待修正"
          value={failedCount}
          tint="text-red-300 bg-red-500/10"
          active={quick === 'todo'}
          highlight={failedCount > 0}
          onClick={() => setQuick('todo')}
        />
        <ClickableStatCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          title="已完成"
          value={doneCount}
          tint="text-emerald-300 bg-emerald-500/10"
          active={quick === 'done'}
          onClick={() => setQuick('done')}
        />
        <ClickableStatCard
          icon={<Bot className="h-5 w-5" />}
          title="AI 识别"
          value={aiCount ?? '—'}
          tint="text-purple-300 bg-purple-500/10"
          active={quick === 'ai'}
          onClick={() => setQuick('ai')}
          subtitle={aiReady === false ? '未配置' : ''}
        />
      </div>

      {/* ============ Emby 库分布条（按 CollectionType 聚合）============ */}
      {stats && stats.total > 0 && (
        <div className="glass-panel-subtle rounded-xl p-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-[var(--text-tertiary)]">
              Emby / Jellyfin 库分布 · <span className="text-[var(--text-secondary)]">CollectionType</span>
            </span>
            <span className="text-[10px] text-[var(--text-tertiary)]">
              对齐官方枚举：movies / tvshows / music / mixed · 仅作预览
            </span>
          </div>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--bg-card)]">
            {(['movies', 'tvshows', 'music', 'mixed'] as EmbyCollectionType[]).map((ct) => {
              const v = embyDistribution[ct] || 0
              const pct = stats.total > 0 ? (v / stats.total) * 100 : 0
              if (pct <= 0) return null
              const color: Record<EmbyCollectionType, string> = {
                movies: 'bg-sky-500',
                tvshows: 'bg-violet-500',
                music: 'bg-pink-500',
                photos: 'bg-orange-500',
                mixed: 'bg-zinc-500',
                homevideos: 'bg-emerald-500',
                boxsets: 'bg-yellow-500',
              }
              return (
                <div
                  key={ct}
                  className={clsx('h-full', color[ct])}
                  style={{ width: `${pct}%` }}
                  title={`${embyCollectionTypeDisplay[ct]} · ${v} 条 (${pct.toFixed(1)}%)`}
                />
              )
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
            {(['movies', 'tvshows', 'music', 'mixed'] as EmbyCollectionType[]).map((ct) => {
              const v = embyDistribution[ct] || 0
              if (v <= 0) return null
              const dot: Record<EmbyCollectionType, string> = {
                movies: 'bg-sky-500',
                tvshows: 'bg-violet-500',
                music: 'bg-pink-500',
                photos: 'bg-orange-500',
                mixed: 'bg-zinc-500',
                homevideos: 'bg-emerald-500',
                boxsets: 'bg-yellow-500',
              }
              return (
                <span key={ct} className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                  <span className={clsx('h-2 w-2 rounded-full', dot[ct])} />
                  <span className="font-medium">{embyCollectionTypeDisplay[ct]}</span>
                  <span className="text-[var(--text-tertiary)]">{v.toLocaleString()}</span>
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* ============ 快捷标签 + 搜索 ============ */}
      <div className="glass-panel-subtle rounded-xl p-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* 快捷标签 */}
          <div className="flex items-center gap-1.5">
            {QUICK_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setQuick(t.key)}
                className={clsx(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition',
                  quick === t.key
                    ? 'bg-primary-600 text-white'
                    : 'border border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:border-primary-500',
                )}
              >
                <span className={quick === t.key ? '' : t.tint}>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                ref={searchRef}
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                placeholder="搜索标题 / 建议名称（F）"
                className="w-56 rounded-md border border-[var(--border-default)] bg-[var(--bg-input)] py-1.5 pl-8 pr-3 text-sm text-[var(--text-primary)] focus:border-primary-500 focus:outline-none"
              />
            </div>
            <button
              onClick={() => {
                loadList()
                loadStats()
              }}
              className="rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] p-2 text-[var(--text-secondary)] hover:border-primary-500"
              title="刷新"
            >
              <RefreshCw className={clsx('h-3.5 w-3.5', loading && 'animate-spin')} />
            </button>
            {expertMode && (
              <button
                onClick={() => setAdvancedOpen((v) => !v)}
                className="flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:border-primary-500"
              >
                高级筛选
                <ChevronDown
                  className={clsx('h-3 w-3 transition-transform', advancedOpen && 'rotate-180')}
                />
              </button>
            )}
          </div>
        </div>

        {/* 高级筛选（仅专家模式 + 展开） */}
        {expertMode && advancedOpen && (
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--border-default)]/60 pt-3 md:grid-cols-4">
            <Select
              value={category}
              onChange={(v) => setCategory(v as ClassificationCategory | '')}
              options={CATEGORY_OPTIONS}
            />
            <Select value={region} onChange={(v) => setRegion(v)} options={REGION_OPTIONS} />
            <button
              onClick={handleClear}
              disabled={clearing}
              className={clsx(
                'flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition',
                clearing
                  ? 'cursor-not-allowed bg-[var(--bg-surface)] text-[var(--text-tertiary)]'
                  : 'bg-red-500/10 text-red-300 hover:bg-red-500/20',
              )}
            >
              {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              ⚠️ 删除归类记录
            </button>
          </div>
        )}

        {message && (
          <div
            className={clsx(
              'mt-3 flex items-center justify-between rounded-md px-3 py-2 text-sm',
              message.type === 'ok' && 'bg-emerald-500/10 text-emerald-200',
              message.type === 'err' && 'bg-red-500/10 text-red-200',
              message.type === 'info' && 'bg-blue-500/10 text-blue-200',
            )}
          >
            <span>{message.text}</span>
            <button onClick={() => setMessage(null)}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* ============ 列表 ============ */}
      <div className="glass-panel-subtle overflow-hidden rounded-xl">
        <div className="border-b border-[var(--border-default)]/60 px-4 py-2.5 text-xs text-[var(--text-tertiary)]">
          共 <span className="font-semibold text-[var(--text-primary)]">{total}</span> 条
          {quick === 'todo' && <span className="ml-2 text-red-300">· 仅显示待修正</span>}
          {libraryID && (
            <span className="ml-2 text-[var(--text-secondary)]">· 库：{targetLibName}</span>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-[var(--text-tertiary)]">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            加载中…
          </div>
        ) : items.length === 0 ? (
          <EmptyState quick={quick} onReprocess={handleReprocess} />
        ) : (
          <div className="divide-y divide-[var(--border-default)]/60">
            {items.map((it) => (
              <Row
                key={it.id}
                item={it}
                expertMode={expertMode}
                expanded={expandedId === it.id}
                onToggle={() => setExpandedId(expandedId === it.id ? null : it.id)}
                onCorrect={() => setCorrectTarget(it)}
                onRetry={() => handleRetryOne(it.media_id)}
              />
            ))}
          </div>
        )}

        {/* 分页条：始终显示，便于随时调整每页条数 */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-default)]/60 px-4 py-2 text-xs">
          <div className="flex items-center gap-3 text-[var(--text-tertiary)]">
            <span>
              第 <span className="text-[var(--text-secondary)]">{page}</span> / {totalPages} 页
            </span>
            <span className="text-[var(--text-tertiary)]">·</span>
            <span>
              共 <span className="text-[var(--text-secondary)]">{total}</span> 条
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[var(--text-tertiary)]">
              <span>每页</span>
              <select
                value={size}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10)
                  if (!Number.isNaN(v)) {
                    setSize(v)
                    setPage(1)
                  }
                }}
                className="rounded border border-[var(--border-default)] bg-[var(--bg-card)] px-2 py-1 text-[var(--text-secondary)] focus:border-neon-blue focus:outline-none"
                title="每页显示条数"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <span>条</span>
            </label>
            <div className="flex gap-1">
              <button
                disabled={page <= 1}
                onClick={() => setPage(1)}
                className="rounded border border-[var(--border-default)] px-2 py-1 text-[var(--text-secondary)] disabled:opacity-40"
                title="首页"
              >
                «
              </button>
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded border border-[var(--border-default)] px-3 py-1 text-[var(--text-secondary)] disabled:opacity-40"
              >
                上一页
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded border border-[var(--border-default)] px-3 py-1 text-[var(--text-secondary)] disabled:opacity-40"
              >
                下一页
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(totalPages)}
                className="rounded border border-[var(--border-default)] px-2 py-1 text-[var(--text-secondary)] disabled:opacity-40"
                title="末页"
              >
                »
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 修正弹层 */}
      {correctTarget && (
        <CorrectModal
          item={correctTarget}
          onCancel={() => setCorrectTarget(null)}
          onSubmit={handleCorrectSubmit}
        />
      )}

      {/* 快捷键帮助 */}
      {shortcutHelpOpen && (
        <ShortcutHelpModal onClose={() => setShortcutHelpOpen(false)} />
      )}

      {/* 智能重命名抽屉（Phase 2）— 仅专家模式下从本面板调出 */}
      <SmartRenameDrawer
        open={renameDrawerOpen}
        library={
          libraryID ? libraries.find((l) => l.id === libraryID) || null : null
        }
        onClose={() => setRenameDrawerOpen(false)}
      />

      {/* 设置抽屉（A+C 极简模式：把专家功能 / 危险区 / 快捷键全收纳在这里） */}
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        expertMode={expertMode}
        onToggleExpert={() => setExpertMode((v) => !v)}
        aiReady={aiReady}
        libraryID={libraryID}
        libraryName={targetLibName || ''}
        onOpenRename={() => {
          if (!libraryID) {
            setMessage({
              type: 'err',
              text: '请先选定具体媒体库后再使用「应用到磁盘」（不支持全库范围）',
            })
            return
          }
          setSettingsOpen(false)
          setRenameDrawerOpen(true)
        }}
        onClear={() => {
          setSettingsOpen(false)
          handleClear()
        }}
        clearing={clearing}
        onOpenShortcut={() => {
          setSettingsOpen(false)
          setShortcutHelpOpen(true)
        }}
        onConfigAI={() => {
          setSettingsOpen(false)
          window.location.hash = '#ai'
        }}
      />
    </div>
  )
}

// ============ 子组件 ============

function Select({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-primary-500 focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function ClickableStatCard({
  icon,
  title,
  value,
  tint,
  active,
  highlight,
  onClick,
  subtitle,
}: {
  icon: React.ReactNode
  title: string
  value: number | string
  tint: string
  active?: boolean
  highlight?: boolean
  onClick?: () => void
  subtitle?: string
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'group glass-panel rounded-xl p-4 text-left transition-all',
        active && 'ring-2 ring-primary-500',
        highlight && !active && 'ring-1 ring-red-500/40',
        onClick && 'hover:scale-[1.02]',
      )}
    >
      <div className="flex items-center gap-3">
        <div className={clsx('rounded-lg p-2', tint)}>{icon}</div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-[var(--text-tertiary)]">
            {title}
            {subtitle && <span className="ml-1.5 text-amber-300">· {subtitle}</span>}
          </p>
          <p className="text-2xl font-semibold text-theme-primary">
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
        </div>
      </div>
    </button>
  )
}

function EmptyState({
  quick,
  onReprocess,
}: {
  quick: QuickFilter
  onReprocess: () => void
}) {
  if (quick === 'todo') {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-[var(--text-tertiary)]">
        <CheckCircle2 className="h-10 w-10 text-emerald-400 opacity-60" />
        <p className="mt-2 text-sm font-medium text-emerald-300">没有待修正的条目 🎉</p>
        <p className="mt-1 text-xs">所有媒体识别均已完成</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center justify-center py-16 text-[var(--text-tertiary)]">
      <Database className="h-10 w-10 opacity-40" />
      <p className="mt-2 text-sm">暂无记录</p>
      <p className="mt-1 text-xs">扫描媒体库后将自动产出识别结果</p>
      <button
        onClick={onReprocess}
        className="mt-4 flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-500"
      >
        <Zap className="h-4 w-4" />
        立即开始识别
      </button>
    </div>
  )
}

function Row({
  item,
  expertMode,
  expanded,
  onToggle,
  onCorrect,
  onRetry,
}: {
  item: MediaClassification
  expertMode: boolean
  expanded: boolean
  onToggle: () => void
  onCorrect: () => void
  onRetry: () => void
}) {
  const isFailed = item.status === 'failed' || item.status === 'partial'
  const isProcessing = item.status === 'running' || item.status === 'pending'
  // 标题展示策略（图片中"<未识别>"全是因为 running 时段 parsed_title 为空导致）：
  // 1) 有 parsed_title → 直接展示
  // 2) running/pending → 「识别中…」+ spinner
  // 3) failed/partial 但完全没字段 → 「识别失败」红色
  // 4) 其他兜底 → 「未识别」
  const hasParsed = !!(item.parsed_title || item.suggested_name)
  return (
    <div
      className={clsx(
        'group px-4 py-3 transition-colors hover:bg-[var(--nav-hover-bg)]',
        isFailed && 'bg-red-500/5',
        isProcessing && 'bg-blue-500/5',
      )}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onToggle}
              className={clsx(
                'truncate text-left text-sm font-medium hover:text-primary-300',
                hasParsed
                  ? 'text-[var(--text-primary)]'
                  : isProcessing
                    ? 'text-[var(--text-secondary)] italic'
                    : isFailed
                      ? 'text-red-400'
                      : 'text-[var(--text-tertiary)] italic',
              )}
              title="点击展开详情"
            >
              {hasParsed ? (
                item.parsed_title || item.suggested_name
              ) : isProcessing ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  识别中…
                </span>
              ) : isFailed ? (
                <span className="inline-flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  识别失败
                </span>
              ) : (
                '未识别'
              )}
            </button>
            {item.parsed_year > 0 && (
              <span className="rounded bg-[var(--nav-hover-bg)] px-1.5 py-0.5 text-xs text-[var(--text-secondary)]">
                {item.parsed_year}
              </span>
            )}
            {item.parsed_tmdb_id > 0 && (
              <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-xs text-blue-300">
                TMDb {item.parsed_tmdb_id}
              </span>
            )}
            {item.ai_invoked && (
              <span
                className="rounded bg-purple-500/10 px-1.5 py-0.5 text-xs text-purple-300"
                title={item.ai_model ? `${item.ai_provider || 'AI'} · ${item.ai_model}` : 'AI'}
              >
                <Bot className="mr-0.5 inline h-3 w-3" />
                AI
              </span>
            )}
            {/* 失败时把错误简述挂在标题旁，便于快速判断（如 AI 401） */}
            {isFailed && item.error_msg && (
              <span
                className="max-w-[24rem] truncate rounded bg-red-500/10 px-1.5 py-0.5 text-xs text-red-300"
                title={item.error_msg}
              >
                {item.error_msg.replace(/^\[cancelled\]\s*/, '⛔ 已取消 · ')}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
            {/* Emby CollectionType 徽章（帮助用户预览在 Emby/Jellyfin 客户端中会落哪个库）*/}
            {item.category && (
              <EmbyCollectionBadge category={item.category as string} />
            )}
            {item.category && (
              <span>{categoryDisplay[item.category as string] || item.category}</span>
            )}
            {item.region && <span>· {regionDisplay[item.region] || item.region}</span>}
            {item.decade && <span>· {item.decade}</span>}
            {item.quality_tier && (
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-300">
                {item.quality_tier}
              </span>
            )}
            {/* 仅在确实跑过识别（confidence > 0）时才展示匹配度，避免 0% 误导 */}
            {item.confidence > 0 && (
              <span className={clsx(item.confidence < 0.6 && 'text-amber-300')}>
                匹配度 {(item.confidence * 100).toFixed(0)}%
              </span>
            )}
            {/* 没有任何元信息时，给一行轻量占位，避免空荡 */}
            {!hasParsed && !item.category && item.confidence === 0 && (
              <span className="text-[var(--text-tertiary)]">
                {isProcessing ? '等待 AI 返回结果' : '无元数据'}
              </span>
            )}
          </div>
        </div>

        {/* 状态标签 */}
        <span
          className={clsx(
            'shrink-0 rounded px-2 py-0.5 text-xs font-medium',
            statusColor[item.status] || 'bg-gray-500/15 text-gray-300',
          )}
        >
          {statusDisplay[item.status] || item.status}
        </span>

        {/* 行内操作（hover 显示） */}
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={onCorrect}
            className="rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:border-primary-500 hover:text-primary-300"
            title="修改识别结果"
          >
            <Pencil className="mr-1 inline h-3 w-3" />
            修改
          </button>
          <button
            onClick={onRetry}
            className="rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:border-primary-500 hover:text-primary-300"
            title="重新识别该条"
          >
            <RotateCw className="mr-1 inline h-3 w-3" />
            重试
          </button>
        </div>
      </div>

      {/* 展开详情：Emby NFO 字段顺序对齐（title / sortname / year / genre / country / tmdb / imdb / suggested）*/}
      {expanded && (
        <div className="mt-3 grid grid-cols-1 gap-2 rounded-lg bg-[var(--nav-hover-bg)] p-3 text-xs md:grid-cols-2">
          {/* === 识别结果（对应 NFO 顺序）=== */}
          <KV label="Title · 主标题" value={item.parsed_title || '—'} />
          {item.parsed_title_alt && (
            <KV label="OriginalTitle · 原名" value={item.parsed_title_alt} />
          )}
          <KV label="Year · 年份" value={item.parsed_year > 0 ? String(item.parsed_year) : '—'} />
          <KV
            label="Genre · 类型标签"
            value={
              [
                categoryDisplay[item.category as string] || '',
                categoryToEmbyGenre[item.category as string] || '',
                item.genre_tags || '',
              ]
                .filter(Boolean)
                .join(' / ') || '—'
            }
          />
          <KV
            label="Country / Region · 国家地区"
            value={item.region ? regionDisplay[item.region] || item.region : '—'}
          />
          <KV
            label="TMDb ID"
            value={item.parsed_tmdb_id > 0 ? String(item.parsed_tmdb_id) : '—'}
            mono
          />
          <KV label="IMDb ID" value={item.parsed_imdb_id || '—'} mono />

          {/* === 路径/建议重命名（仅写入数据库）=== */}
          <div className="md:col-span-2 mt-1 border-t border-[var(--border-default)]/40 pt-2">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              Emby/Jellyfin 建议命名（仅数据库映射，不会落盘）
            </p>
          </div>
          <KV label="原文件路径" value={item.media_id} mono />
          <KV label="建议名称" value={item.suggested_name || '—'} mono />
          <div className="md:col-span-2">
            <KV
              label="建议路径（DB 映射）"
              value={item.suggested_full_path || '—'}
              mono
            />
          </div>
          {item.error_msg && (
            <div className="md:col-span-2">
              <KV label="Error · 错误信息" value={item.error_msg} mono />
            </div>
          )}
          {expertMode && (
            <>
              <KV label="Language · 语言" value={item.language_tag || '—'} />
              <KV label="Decade · 年代" value={item.decade || '—'} />
              <KV label="建议子目录" value={item.suggested_dir || '—'} mono />
              <KV label="命名风格" value={item.naming_style || 'jellyfin'} />
              {item.ai_invoked && (
                <>
                  <KV label="AI 服务商" value={item.ai_provider || '—'} />
                  <KV label="AI 模型" value={item.ai_model || '—'} mono />
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ============ Emby CollectionType 徽章 ============
//
// 业务类别 → Emby 官方 CollectionType 映射，
// 让用户一眼明白该条目会落在 Emby/Jellyfin 客户端哪个库。
function EmbyCollectionBadge({ category }: { category: string }) {
  const ct = categoryToEmbyCollectionType[category]
  if (!ct) return null
  const palette: Record<EmbyCollectionType, string> = {
    movies: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    tvshows: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
    music: 'bg-pink-500/15 text-pink-300 border-pink-500/30',
    photos: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    mixed: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
    homevideos: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    boxsets: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
  }
  const subGenre = categoryToEmbyGenre[category]
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono',
        palette[ct],
      )}
      title={`Emby CollectionType: ${ct}${subGenre ? ` / Genre: ${subGenre}` : ''}`}
    >
      {embyCollectionTypeDisplay[ct]}
      {subGenre && <span className="text-[var(--text-secondary)]/80">/{subGenre}</span>}
    </span>
  )
}

function KV({
  label,
  value,
  mono,
}: {
  label: React.ReactNode
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <p className="text-[var(--text-tertiary)]">{label}</p>
      <p className={clsx('mt-0.5 break-all text-[var(--text-secondary)]', mono && 'font-mono')}>{value}</p>
    </div>
  )
}

// ============ 修正弹层 ============

function CorrectModal({
  item,
  onCancel,
  onSubmit,
}: {
  item: MediaClassification
  onCancel: () => void
  onSubmit: (
    item: MediaClassification,
    payload: {
      title?: string
      year?: number
      tmdb_id?: number
      imdb_id?: string
      category?: string
      region?: string
    },
  ) => void
}) {
  const [title, setTitle] = useState(item.parsed_title || '')
  const [year, setYear] = useState(String(item.parsed_year || ''))
  const [tmdbId, setTmdbId] = useState(String(item.parsed_tmdb_id || ''))
  const [imdbId, setImdbId] = useState(item.parsed_imdb_id || '')
  const [category, setCategory] = useState(item.category || '')
  const [region, setRegion] = useState(item.region || '')

  const handleSave = () => {
    onSubmit(item, {
      title: title.trim() || undefined,
      year: parseInt(year, 10) || 0,
      tmdb_id: parseInt(tmdbId, 10) || 0,
      imdb_id: imdbId.trim() || undefined,
      category: category || undefined,
      region: region || undefined,
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        className="glass-panel max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">修正识别结果</h3>
          <button onClick={onCancel} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
          所有修改仅写入数据库，不会修改任何磁盘文件。
        </p>

        <div className="mt-4 space-y-3">
          <Field label="标题">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-primary-500 focus:outline-none"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="年份">
              <input
                value={year}
                onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))}
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-primary-500 focus:outline-none"
                placeholder="如 2024"
              />
            </Field>
            <Field label="TMDb ID">
              <input
                value={tmdbId}
                onChange={(e) => setTmdbId(e.target.value.replace(/\D/g, ''))}
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-primary-500 focus:outline-none"
                placeholder="如 12345"
              />
            </Field>
          </div>
          <Field label="IMDb ID">
            <input
              value={imdbId}
              onChange={(e) => setImdbId(e.target.value)}
              className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-primary-500 focus:outline-none"
              placeholder="如 tt0133093"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="类别">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-primary-500 focus:outline-none"
              >
                {CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="地区">
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-primary-500 focus:outline-none"
              >
                {REGION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:border-primary-500"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-500"
          >
            保存修正
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-[var(--text-tertiary)]">{label}</label>
      {children}
    </div>
  )
}

// ============ 快捷键帮助 ============

function ShortcutHelpModal({ onClose }: { onClose: () => void }) {
  const items: { key: string; desc: string }[] = [
    { key: 'R', desc: '一键重跑（按当前已选媒体库）' },
    { key: 'F', desc: '聚焦搜索框' },
    { key: '1', desc: '切换到「全部」' },
    { key: '2', desc: '切换到「待修正」' },
    { key: '3', desc: '切换到「已完成」' },
    { key: '4', desc: '切换到「AI 识别」' },
    { key: '?', desc: '显示/隐藏此帮助' },
    { key: 'Esc', desc: '关闭弹层' },
  ]
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="glass-panel w-full max-w-sm rounded-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">键盘快捷键</h3>
          <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="mt-3 space-y-1.5 text-sm">
          {items.map((it) => (
            <li
              key={it.key}
              className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-[var(--nav-hover-bg)]"
            >
              <kbd className="rounded border border-[var(--border-default)] bg-[var(--bg-card)] px-2 py-0.5 font-mono text-xs text-[var(--text-secondary)]">
                {it.key}
              </kbd>
              <span className="text-[var(--text-secondary)]">{it.desc}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ============ SettingsDrawer 子组件（A+C 极简模式：收纳所有"非主路径"操作） ============

function SettingsDrawer({
  open,
  onClose,
  expertMode,
  onToggleExpert,
  aiReady,
  libraryID,
  libraryName,
  onOpenRename,
  onClear,
  clearing,
  onOpenShortcut,
  onConfigAI,
}: {
  open: boolean
  onClose: () => void
  expertMode: boolean
  onToggleExpert: () => void
  aiReady: boolean | null
  libraryID: string
  libraryName: string
  onOpenRename: () => void
  onClear: () => void
  clearing: boolean
  onOpenShortcut: () => void
  onConfigAI: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex justify-end" onClick={onClose}>
      {/* 蒙版 */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      {/* 抽屉 */}
      <div
        className="relative h-full w-full max-w-md overflow-y-auto border-l border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 抽屉头 */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border-default)] bg-[var(--bg-elevated)]/95 px-5 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-primary-300" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">归类设置</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-[var(--text-secondary)] hover:bg-[var(--nav-hover-bg)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {/* 1. AI 配置状态 */}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
              AI 服务
            </h4>
            <div
              className={clsx(
                'flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm',
                aiReady
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200'
                  : 'border-amber-500/30 bg-amber-500/5 text-amber-200',
              )}
            >
              <div className="flex items-center gap-2">
                {aiReady ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                <span className="text-xs">
                  {aiReady ? 'AI 已配置并启用，识别准确率 95%+' : 'AI 未配置，无法启动智能归类'}
                </span>
              </div>
              <button
                onClick={onConfigAI}
                className={clsx(
                  'shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition',
                  aiReady
                    ? 'border border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:border-primary-500'
                    : 'bg-amber-500/20 text-amber-100 hover:bg-amber-500/30',
                )}
              >
                {aiReady ? '调整' : '立即配置'}
              </button>
            </div>
          </section>

          {/* 2. 显示模式 */}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
              显示模式
            </h4>
            <button
              onClick={onToggleExpert}
              className="flex w-full items-center justify-between rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2.5 text-left transition hover:border-primary-500"
            >
              <div>
                <div className="text-sm font-medium text-[var(--text-primary)]">
                  {expertMode ? '专家模式' : '小白模式'}
                </div>
                <div className="mt-0.5 text-xs text-[var(--text-tertiary)]">
                  {expertMode
                    ? '已启用：高级筛选、应用到磁盘等专家功能可见'
                    : '默认：仅显示常用操作，避免误触'}
                </div>
              </div>
              <div
                className={clsx(
                  'relative h-5 w-9 shrink-0 rounded-full transition',
                  expertMode ? 'bg-primary-500' : 'bg-[var(--bg-surface)]',
                )}
              >
                <div
                  className={clsx(
                    'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all',
                    expertMode ? 'left-[18px]' : 'left-0.5',
                  )}
                />
              </div>
            </button>
          </section>

          {/* 3. 专家功能（仅专家模式 + AI 就绪） */}
          {expertMode && aiReady && (
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                专家功能
              </h4>
              <div className="space-y-2">
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    <div className="text-xs text-amber-200/90">
                      <div className="font-semibold text-amber-200">应用建议名称到磁盘</div>
                      <div className="mt-1 text-amber-300/80">
                        将识别出的「建议名称」真实重命名磁盘上的原始文件，可回滚。
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={onOpenRename}
                    disabled={!libraryID}
                    className={clsx(
                      'mt-2 flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition',
                      libraryID
                        ? 'border border-amber-400/40 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25'
                        : 'cursor-not-allowed border border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-tertiary)]',
                    )}
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    {libraryID ? `⚠️ 应用到《${libraryName || '当前库'}》` : '请先在主页面选定具体媒体库'}
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* 4. 危险区：删除归类记录 */}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-300/80">
              危险区
            </h4>
            <button
              onClick={onClear}
              disabled={clearing}
              className={clsx(
                'flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition',
                clearing
                  ? 'cursor-not-allowed border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-tertiary)]'
                  : 'border-red-500/30 bg-red-500/5 text-red-200 hover:bg-red-500/10',
              )}
            >
              <div className="text-left">
                <div className="font-medium">删除归类记录</div>
                <div className="mt-0.5 text-xs text-red-300/70">
                  {libraryID ? `仅删除《${libraryName || '当前库'}》的归类记录` : '删除全部归类记录'}（不可恢复）
                </div>
              </div>
              {clearing ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 shrink-0" />
              )}
            </button>
          </section>

          {/* 5. 快捷键 */}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
              帮助
            </h4>
            <button
              onClick={onOpenShortcut}
              className="flex w-full items-center justify-between rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2.5 text-sm text-[var(--text-secondary)] transition hover:border-primary-500"
            >
              <div className="flex items-center gap-2">
                <Keyboard className="h-4 w-4" />
                <span>键盘快捷键</span>
              </div>
              <span className="text-xs text-[var(--text-tertiary)]">按 ? 查看</span>
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
