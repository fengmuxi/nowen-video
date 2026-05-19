import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { adminApi, libraryApi } from '@/api'
import { preprocessApi } from '@/api/preprocess'
import { useWebSocket, WS_EVENTS } from '@/hooks/useWebSocket'
import { useToast } from '@/components/Toast'
import { useDialog } from '@/components/Dialog'
import { usePagination } from '@/hooks/usePagination'
import Pagination from '@/components/Pagination'
import { formatSize } from '@/utils/format'
import type { TranscodeJob, TranscodeStatistics, PreprocessCandidate, Library } from '@/types'
import type { TranscodeProgressData } from '@/hooks/useWebSocket'
import {
  HardDrive,
  Zap,
  Loader2,
  RefreshCw,
  XCircle,
  RotateCcw,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Clock,
  CheckSquare,
  Square,
  Cpu,
  Film,
  Send,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import clsx from 'clsx'

// 转码可选档位（与后端 qualityPresets 一致）
const TRANSCODE_QUALITIES = ['360p', '480p', '720p', '1080p'] as const

// 每档位的总码率（视频+音频，单位 Mbps）——与后端 qualityPresets 保持同步
// 用于面板中给用户预估「每分钟 / 本次提交」的转码产出大小
const QUALITY_BITRATE_MBPS: Record<string, number> = {
  '360p': 0.896,   // 800k + 96k
  '480p': 1.628,   // 1500k + 128k
  '720p': 3.128,   // 3000k + 128k
  '1080p': 6.192,  // 6000k + 192k
}

// ==================== 状态映射（与预处理面板共享语义） ====================
// 转码服务实际状态：pending / running / done / failed / cancelled
// 这里同时兼容预处理风格的命名（completed），方便潜在的字段统一
const statusLabels: Record<string, string> = {
  pending: '等待中',
  queued: '排队中',
  running: '处理中',
  done: '已完成',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

const statusColors: Record<string, string> = {
  pending: 'text-yellow-400',
  queued: 'text-amber-400',
  running: 'text-neon-blue',
  done: 'text-emerald-400',
  completed: 'text-emerald-400',
  failed: 'text-red-400',
  cancelled: 'text-surface-500',
}

const statusIcons: Record<string, ReactNode> = {
  pending: <Clock size={14} />,
  queued: <Clock size={14} />,
  running: <Loader2 size={14} className="animate-spin" />,
  done: <CheckCircle2 size={14} />,
  completed: <CheckCircle2 size={14} />,
  failed: <AlertCircle size={14} />,
  cancelled: <XCircle size={14} />,
}

// 状态筛选选项（顶部按钮组）
const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'running', label: '处理中' },
  { value: 'pending', label: '等待中' },
  { value: 'done', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已取消' },
]

/**
 * 转码任务面板
 *
 * 与「视频预处理」面板的列表交互保持一致：
 *   - 顶部统计：处理中 / 失败 / 已完成 / 硬件加速
 *   - 状态筛选 + 分页
 *   - 复选 + 批量取消 / 批量重试 / 批量删除
 *   - 单条操作：取消（运行中） / 重试（失败/取消） / 删除（终态）
 *   - 实时进度：订阅 WS 转码事件，运行中卡片展示实时进度条
 *
 * 注意：转码服务本身不支持暂停/恢复（节流由播放进度驱动），所以不提供这两个按钮。
 */
export default function TranscodeJobsPanel() {
  const toast = useToast()
  const dialog = useDialog()
  const toastRef = useRef(toast)
  toastRef.current = toast

  const { on, off } = useWebSocket()

  const [jobs, setJobs] = useState<TranscodeJob[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<TranscodeStatistics | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const { page, size: pageSize, setPage, setSize, totalPages: calcTotalPages } = usePagination({ initialSize: 10 })
  const totalPages = calcTotalPages(total)

  // 实时进度（仅运行中任务的 WS 推送）
  const [progressMap, setProgressMap] = useState<Record<string, TranscodeProgressData>>({})

  // 选中状态
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchLoading, setBatchLoading] = useState(false)

  // ==================== 数据加载 ====================
  // 兼容后端可能的不同响应包装：{ data: { tasks, total } } 或直接 { tasks, total }
  const loadJobs = useCallback(async () => {
    try {
      const res = await adminApi.listTranscodeTasks(page, pageSize, statusFilter)
      const body: any = res.data
      const payload = body?.data ?? body ?? {}
      setJobs(Array.isArray(payload.tasks) ? payload.tasks : [])
      setTotal(typeof payload.total === 'number' ? payload.total : 0)
    } catch (e) {
      console.error('[TranscodeJobsPanel] 加载转码任务失败:', e)
      setJobs([])
      setTotal(0)
      toastRef.current.error('加载转码任务失败')
    }
  }, [page, pageSize, statusFilter])

  const loadStats = useCallback(async () => {
    try {
      const res = await adminApi.getTranscodeStatistics()
      const body: any = res.data
      const payload = body?.data ?? body ?? null
      setStats(payload)
    } catch (e) {
      console.error('[TranscodeJobsPanel] 加载转码统计失败:', e)
      // 静默失败：保留上次数据
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([loadJobs(), loadStats()]).finally(() => setLoading(false))
  }, [loadJobs, loadStats])

  // 切换筛选时清空选中
  useEffect(() => {
    setSelectedIds(new Set())
  }, [statusFilter, page])

  // ==================== WebSocket 实时进度 ====================
  // 节流刷新：3 秒最多触发一次列表/统计的重新拉取
  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let needsRefresh = false
    const scheduleRefresh = () => {
      if (refreshTimer) {
        needsRefresh = true
        return
      }
      loadJobs()
      loadStats()
      refreshTimer = setTimeout(() => {
        if (refreshTimer) clearTimeout(refreshTimer)
        refreshTimer = null
        if (needsRefresh) {
          needsRefresh = false
          loadJobs()
          loadStats()
        }
      }, 3000)
    }

    const onStarted = (data: TranscodeProgressData) => {
      setProgressMap((prev) => ({ ...prev, [data.task_id]: data }))
      scheduleRefresh()
    }
    const onProgress = (data: TranscodeProgressData) => {
      setProgressMap((prev) => ({ ...prev, [data.task_id]: data }))
    }
    const onCompleted = (data: TranscodeProgressData) => {
      setProgressMap((prev) => {
        const next = { ...prev }
        delete next[data.task_id]
        return next
      })
      scheduleRefresh()
    }
    const onFailed = (data: TranscodeProgressData) => {
      setProgressMap((prev) => {
        const next = { ...prev }
        delete next[data.task_id]
        return next
      })
      scheduleRefresh()
    }

    on(WS_EVENTS.TRANSCODE_STARTED, onStarted)
    on(WS_EVENTS.TRANSCODE_PROGRESS, onProgress)
    on(WS_EVENTS.TRANSCODE_COMPLETED, onCompleted)
    on(WS_EVENTS.TRANSCODE_FAILED, onFailed)
    return () => {
      off(WS_EVENTS.TRANSCODE_STARTED, onStarted)
      off(WS_EVENTS.TRANSCODE_PROGRESS, onProgress)
      off(WS_EVENTS.TRANSCODE_COMPLETED, onCompleted)
      off(WS_EVENTS.TRANSCODE_FAILED, onFailed)
      if (refreshTimer) clearTimeout(refreshTimer)
    }
  }, [on, off, loadJobs, loadStats])

  // ==================== 选择 ====================
  const isAllSelected = jobs.length > 0 && jobs.every((j) => selectedIds.has(j.id))
  const isSomeSelected = selectedIds.size > 0

  const toggleSelectAll = () => {
    if (isAllSelected) {
      const next = new Set(selectedIds)
      jobs.forEach((j) => next.delete(j.id))
      setSelectedIds(next)
    } else {
      const next = new Set(selectedIds)
      jobs.forEach((j) => next.add(j.id))
      setSelectedIds(next)
    }
  }

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  // ==================== 单条操作 ====================
  const handleCancel = async (id: string) => {
    try {
      await adminApi.cancelTranscodeTask(id)
      toastRef.current.success('已取消')
      loadJobs()
      loadStats()
    } catch (e: any) {
      toastRef.current.error(e?.response?.data?.error || '取消失败')
    }
  }

  const handleRetry = async (id: string) => {
    try {
      await adminApi.retryTranscodeTask(id)
      toastRef.current.success('已重新提交')
      loadJobs()
      loadStats()
    } catch (e: any) {
      toastRef.current.error(e?.response?.data?.error || '重试失败')
    }
  }

  const handleDelete = async (id: string) => {
    const ok = await dialog.confirm({
      title: '删除转码任务',
      message: '确认删除该转码任务？\n对应的转码缓存目录会一并清理，下次播放需要时会重新生成。',
      confirmText: '删除',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await adminApi.deleteTranscodeTask(id)
      toastRef.current.success('已删除')
      loadJobs()
      loadStats()
    } catch (e: any) {
      toastRef.current.error(e?.response?.data?.error || '删除失败')
    }
  }

  // ==================== 批量操作 ====================
  const handleBatchCancel = async () => {
    if (selectedIds.size === 0) return
    setBatchLoading(true)
    try {
      const res = await adminApi.batchCancelTranscodeTasks([...selectedIds])
      toastRef.current.success(`已取消 ${res.data.data.cancelled} 个任务`)
      setSelectedIds(new Set())
      loadJobs()
      loadStats()
    } catch (e: any) {
      toastRef.current.error(e?.response?.data?.error || '批量取消失败')
    } finally {
      setBatchLoading(false)
    }
  }

  const handleBatchRetry = async () => {
    if (selectedIds.size === 0) return
    setBatchLoading(true)
    try {
      const res = await adminApi.batchRetryTranscodeTasks([...selectedIds])
      toastRef.current.success(`已重试 ${res.data.data.retried} 个任务`)
      setSelectedIds(new Set())
      loadJobs()
      loadStats()
    } catch (e: any) {
      toastRef.current.error(e?.response?.data?.error || '批量重试失败')
    } finally {
      setBatchLoading(false)
    }
  }

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    const ok = await dialog.confirm({
      title: '批量删除转码任务',
      message: `确认删除选中的 ${selectedIds.size} 个转码任务？\n对应的转码缓存目录会一并清理。运行中的任务会被跳过。`,
      confirmText: '删除',
      variant: 'danger',
    })
    if (!ok) return
    setBatchLoading(true)
    try {
      const res = await adminApi.batchDeleteTranscodeTasks([...selectedIds])
      toastRef.current.success(`已删除 ${res.data.data.deleted} 个任务`)
      setSelectedIds(new Set())
      loadJobs()
      loadStats()
    } catch (e: any) {
      toastRef.current.error(e?.response?.data?.error || '批量删除失败')
    } finally {
      setBatchLoading(false)
    }
  }

  // ==================== 渲染辅助 ====================
  const runningCount = stats?.status_counts?.running ?? 0
  const failedCount = stats?.status_counts?.failed ?? 0
  const doneCount = (stats?.status_counts?.done ?? 0) + (stats?.status_counts?.completed ?? 0)

  return (
    <div className="space-y-4">
      {/* 顶部：选源提交转码区域——与预处理面板的 submit Tab 体验一致，允许折叠 */}
      <SourcePicker
        onSubmitted={() => {
          // 提交后刷新任务列表与统计
          loadJobs()
          loadStats()
        }}
      />

      {/* 顶部统计卡片 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard
          icon={<Loader2 size={18} className={stats?.running_count ? 'animate-spin text-neon-blue' : 'text-neon-blue/40'} />}
          label="处理中"
          value={runningCount}
        />
        <StatCard
          icon={<AlertCircle size={18} className={failedCount > 0 ? 'text-red-400' : 'text-red-400/40'} />}
          label="失败"
          value={failedCount}
        />
        <StatCard
          icon={<CheckCircle2 size={18} className="text-emerald-400/70" />}
          label="已完成"
          value={doneCount}
        />
        <StatCard
          icon={<Cpu size={18} className="text-neon-blue/70" />}
          label="硬件加速"
          value={stats?.hw_accel || 'none'}
        />
        <StatCard
          icon={
            <HardDrive
              size={18}
              className={
                (stats?.disk_usage_bytes ?? 0) > 50 * 1024 * 1024 * 1024
                  ? 'text-amber-400'
                  : 'text-neon-blue/70'
              }
            />
          }
          label="缓存占用"
          value={stats?.disk_usage_bytes !== undefined ? formatSize(stats.disk_usage_bytes) : '—'}
          hint={stats?.disk_usage_dir}
        />
      </div>

      {/* 实时转码进度（与原面板保持一致） */}
      {Object.keys(progressMap).length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            <Loader2 size={16} className="animate-spin text-neon-blue" />
            实时进度
          </h2>
          <div className="space-y-2">
            {Object.entries(progressMap).map(([taskId, data]) => (
              <div
                key={`live-${taskId}`}
                className="rounded-xl p-3"
                style={{ background: 'var(--glass-bg)', border: '1px solid var(--neon-blue-6)' }}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    🎥 {data.title} <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({data.quality})</span>
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {data.progress.toFixed(1)}% {data.speed && `· ${data.speed}`}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--progress-track-bg)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${data.progress}%`,
                      background: 'linear-gradient(90deg, var(--neon-purple), var(--neon-blue))',
                      boxShadow: 'var(--progress-bar-glow)',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 工具栏：状态筛选 + 刷新 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {STATUS_FILTERS.map((f) => {
            const active = statusFilter === f.value
            const count = f.value
              ? (stats?.status_counts?.[f.value] ?? 0)
              : Object.values(stats?.status_counts ?? {}).reduce((s, n) => s + Number(n || 0), 0)
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => {
                  setStatusFilter(f.value)
                  setPage(1)
                }}
                className={clsx(
                  'rounded-lg px-3 py-1.5 text-xs transition-all duration-200',
                  active && 'font-medium',
                )}
                style={active
                  ? { background: 'var(--neon-blue-15)', border: '1px solid var(--neon-blue-30)', color: 'var(--text-primary)' }
                  : { background: 'var(--glass-bg)', border: '1px solid var(--neon-blue-6)', color: 'var(--text-muted)' }}
              >
                {f.label}
                {count > 0 && (
                  <span className="ml-1.5" style={{ color: active ? 'var(--neon-blue)' : 'var(--text-muted)' }}>
                    ({count})
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          onClick={() => {
            loadJobs()
            loadStats()
          }}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition hover:bg-[var(--nav-hover-bg)]"
          style={{ color: 'var(--text-muted)', border: '1px solid var(--neon-blue-6)' }}
          title="刷新"
        >
          <RefreshCw size={12} />
          刷新
        </button>
      </div>

      {/* 批量操作栏 */}
      {isSomeSelected && (
        <div
          className="flex items-center gap-3 rounded-xl px-4 py-3"
          style={{ background: 'var(--neon-blue-6)', border: '1px solid var(--neon-blue-15)' }}
        >
          <button
            onClick={toggleSelectAll}
            className="flex items-center gap-1.5 text-xs font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            {isAllSelected ? <CheckSquare size={14} className="text-neon-blue" /> : <Square size={14} />}
            {isAllSelected ? '取消全选' : '全选当前页'}
          </button>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            已选择 <span className="font-medium text-neon-blue">{selectedIds.size}</span> 项
          </span>
          <div className="flex-1" />
          <button
            onClick={handleBatchCancel}
            disabled={batchLoading}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-all hover:bg-yellow-400/10 active:scale-90 disabled:opacity-50"
            style={{ color: 'var(--text-muted)', border: '1px solid var(--neon-blue-6)' }}
          >
            <XCircle size={12} />
            批量取消
          </button>
          <button
            onClick={handleBatchRetry}
            disabled={batchLoading}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-all hover:bg-neon-blue/10 active:scale-90 disabled:opacity-50"
            style={{ color: 'var(--text-muted)', border: '1px solid var(--neon-blue-6)' }}
          >
            <RotateCcw size={12} />
            批量重试
          </button>
          <button
            onClick={handleBatchDelete}
            disabled={batchLoading}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-all hover:bg-red-400/10 hover:text-red-400 active:scale-90 disabled:opacity-50"
            style={{ color: 'var(--text-muted)', border: '1px solid var(--neon-blue-6)' }}
          >
            {batchLoading ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            批量删除
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-xs hover:text-red-400"
            style={{ color: 'var(--text-muted)' }}
          >
            清除选择
          </button>
        </div>
      )}

      {/* 列表头部：全选 + 总数提示 */}
      {jobs.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2">
          <button
            onClick={toggleSelectAll}
            className="flex items-center gap-2 text-xs"
            style={{ color: 'var(--text-muted)' }}
          >
            {isAllSelected ? <CheckSquare size={16} className="text-neon-blue" /> : <Square size={16} />}
            {isAllSelected ? '取消全选' : '全选'}
          </button>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            共 {total} 条，当前第 {page}/{totalPages} 页
          </span>
        </div>
      )}

      {/* 任务列表 */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-neon/40" />
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16" style={{ color: 'var(--text-muted)' }}>
            <Zap size={48} className="mb-4 opacity-30" />
            <p>暂无转码任务</p>
            <p className="text-xs mt-1">用户播放需要在线转码的影视时会自动产生任务</p>
          </div>
        ) : (
          jobs.map((job) => {
            const live = progressMap[job.id]
            const liveProgress = live?.progress ?? job.progress
            const isRunning = job.status === 'running'
            const isFailedLike = job.status === 'failed' || job.status === 'cancelled'
            const isTerminal = job.status === 'done' || job.status === 'completed' || isFailedLike
            const selected = selectedIds.has(job.id)
            return (
              <div
                key={job.id}
                className={clsx('rounded-xl p-4 transition-all duration-200', selected && 'ring-1 ring-neon-blue/30')}
                style={{
                  background: selected ? 'var(--neon-blue-6)' : 'var(--glass-bg)',
                  border: '1px solid var(--neon-blue-6)',
                }}
              >
                <div className="flex items-start justify-between gap-4">
                  <button
                    onClick={() => toggleSelect(job.id)}
                    className="mt-0.5 shrink-0"
                    style={{ color: selected ? 'var(--neon-blue)' : 'var(--text-muted)' }}
                  >
                    {selected ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={statusColors[job.status]}>{statusIcons[job.status]}</span>
                      <h3 className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {job.media_title || job.media_id}
                      </h3>
                      <span
                        className={clsx('text-xs px-1.5 py-0.5 rounded', statusColors[job.status])}
                        style={{ background: 'var(--neon-blue-6)' }}
                      >
                        {statusLabels[job.status] || job.status}
                      </span>
                      <span
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{ background: 'var(--neon-blue-6)', color: 'var(--text-muted)' }}
                      >
                        {job.quality}
                      </span>
                    </div>

                    {/* 进度条 */}
                    {isRunning && (
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                          <span>{live?.message || '转码中...'}</span>
                          <span>
                            {liveProgress.toFixed(1)}%{live?.speed ? ` · ${live.speed}` : ''}
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full" style={{ background: 'var(--progress-track-bg)' }}>
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${liveProgress}%`,
                              background: 'linear-gradient(90deg, var(--neon-purple), var(--neon-blue))',
                              boxShadow: 'var(--progress-bar-glow)',
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* 详细信息 */}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <span>ID: {job.id.slice(0, 8)}</span>
                      {job.retries !== undefined && job.retries > 0 && <span>重试 {job.retries} 次</span>}
                      {job.error && <span className="text-red-400">{job.error}</span>}
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex items-center gap-1 shrink-0">
                    {(isRunning || job.status === 'pending') && (
                      <button
                        onClick={() => handleCancel(job.id)}
                        className="p-1.5 rounded-lg hover:text-red-400 hover:bg-red-400/10 active:scale-90 transition-all"
                        style={{ color: 'var(--text-muted)' }}
                        title="取消"
                      >
                        <XCircle size={14} />
                      </button>
                    )}
                    {isFailedLike && (
                      <button
                        onClick={() => handleRetry(job.id)}
                        className="p-1.5 rounded-lg hover:text-neon-blue hover:bg-neon-blue/10 active:scale-90 transition-all"
                        style={{ color: 'var(--text-muted)' }}
                        title="重试"
                      >
                        <RotateCcw size={14} />
                      </button>
                    )}
                    {isTerminal && (
                      <button
                        onClick={() => handleDelete(job.id)}
                        className="p-1.5 rounded-lg hover:text-red-400 hover:bg-red-400/10 active:scale-90 transition-all"
                        style={{ color: 'var(--text-muted)' }}
                        title="删除"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* 分页 */}
      {jobs.length > 0 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={pageSize}
          pageSizeOptions={[10, 20, 50, 100]}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setSize(s)
            setSelectedIds(new Set())
          }}
        />
      )}
    </div>
  )
}

// ==================== 顶部统计卡片 ====================
function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode
  label: string
  value: number | string
  hint?: string
}) {
  return (
    <div
      className="rounded-xl p-3 flex items-center gap-3"
      style={{ background: 'var(--glass-bg)', border: '1px solid var(--neon-blue-6)' }}
      title={hint}
    >
      <div className="shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
        <div className="text-lg font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{value}</div>
      </div>
    </div>
  )
}

// ==================== 选源提交转码（顶部折叠区） ====================
/**
 * SourcePicker —— 与「视频预处理 - 选源提交」Tab 体验对齐的选源面板。
 *
 * 复用 preprocessApi.listCandidates 候选影视列表，让用户：
 *   1. 搜索 / 按媒体库 / 类型筛选
 *   2. 选择一个或多个清晰度档位（默认 720p）
 *   3. 勾选影视并一键批量提交转码
 *
 * 与预处理选源的关键差异：
 *   - 不依赖"是否需要预处理"过滤（转码可针对任何媒体重新提交，已完成的会自动复用缓存）
 *   - STRM 文件不允许转码（与预处理一致）
 *   - 必须选择至少一个 quality
 *
 * 默认折叠收起，避免与下方任务列表抢占视觉。
 */
function SourcePicker({ onSubmitted }: { onSubmitted: () => void }) {
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast

  const [expanded, setExpanded] = useState(false)
  const [candidates, setCandidates] = useState<PreprocessCandidate[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // 筛选条件
  const [keyword, setKeyword] = useState('')
  const [keywordInput, setKeywordInput] = useState('')
  const [libraryID, setLibraryID] = useState('')
  const [mediaType, setMediaType] = useState('')
  const [libraries, setLibraries] = useState<Library[]>([])

  // 分页
  const { page, size: pageSize, setPage, setSize, totalPages: calcTotalPages } = usePagination({ initialSize: 12 })
  const totalPages = calcTotalPages(total)

  // 选中影视
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // 选中的清晰度（多选）
  const [qualities, setQualities] = useState<Set<string>>(new Set(['720p']))

  // 根据已选影视 + 已选档位预估本次转码产出总大小（字节）
  // 公式：durationSec * sum(bitrateMbps) * 1024^2 / 8
  // 注意：candidates 仅含当前页可见项，所以跨页选择时这是部分估算
  const estimatedSize = useMemo(() => {
    if (selected.size === 0 || qualities.size === 0) return 0
    const totalBitrate = Array.from(qualities).reduce(
      (s, q) => s + (QUALITY_BITRATE_MBPS[q] ?? 0),
      0,
    )
    if (totalBitrate <= 0) return 0
    let totalSeconds = 0
    candidates.forEach((c) => {
      if (selected.has(c.media_id) && c.duration > 0) {
        totalSeconds += c.duration
      }
    })
    return (totalSeconds * totalBitrate * 1024 * 1024) / 8
  }, [selected, qualities, candidates])

  // 当前页可见的已选项数（用于判断估算是否仅是部分值）
  const visibleSelectedCount = useMemo(
    () => candidates.filter((c) => selected.has(c.media_id)).length,
    [candidates, selected],
  )

  // 加载媒体库（仅展开后第一次加载）
  useEffect(() => {
    if (!expanded) return
    if (libraries.length > 0) return
    libraryApi.list().then((res) => {
      setLibraries(res.data.data || [])
    }).catch(() => {})
  }, [expanded, libraries.length])

  // 加载候选影视
  const loadCandidates = useCallback(async () => {
    if (!expanded) return
    setLoading(true)
    try {
      const res = await preprocessApi.listCandidates({
        page,
        size: pageSize,
        keyword,
        library_id: libraryID,
        media_type: mediaType,
        only_need_preprocess: false,
        sort_by: 'updated_at',
        sort_order: 'desc',
      })
      const list = res.data.data
      setCandidates(list?.items || [])
      setTotal(list?.total || 0)
    } catch (e: any) {
      toastRef.current.error(e?.response?.data?.error || '加载影视列表失败')
      setCandidates([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [expanded, page, pageSize, keyword, libraryID, mediaType])

  useEffect(() => {
    loadCandidates()
  }, [loadCandidates])

  // 切换筛选清空选择
  useEffect(() => {
    setSelected(new Set())
  }, [keyword, libraryID, mediaType, page])

  // 当前页可选项（排除 STRM —— 后端转码不支持网络流直转）
  const eligibleOnPage = useMemo(
    () => candidates.filter((c) => !c.is_strm),
    [candidates]
  )

  const allSelectedOnPage =
    eligibleOnPage.length > 0 && eligibleOnPage.every((c) => selected.has(c.media_id))

  const toggleSelectAll = () => {
    const next = new Set(selected)
    if (allSelectedOnPage) {
      eligibleOnPage.forEach((c) => next.delete(c.media_id))
    } else {
      eligibleOnPage.forEach((c) => next.add(c.media_id))
    }
    setSelected(next)
  }

  const toggleQuality = (q: string) => {
    const next = new Set(qualities)
    if (next.has(q)) next.delete(q)
    else next.add(q)
    setQualities(next)
  }

  const handleSubmit = async () => {
    if (selected.size === 0) {
      toastRef.current.error('请至少选择一项影视')
      return
    }
    if (qualities.size === 0) {
      toastRef.current.error('请至少选择一个清晰度档位')
      return
    }
    setSubmitting(true)
    try {
      const res = await adminApi.batchSubmitTranscodeTasks(
        Array.from(selected),
        Array.from(qualities)
      )
      const submitted = res.data.data?.submitted ?? 0
      const skipped = res.data.data?.skipped ?? 0
      toastRef.current.success(
        skipped > 0
          ? `已提交 ${submitted} 项转码，跳过 ${skipped} 项`
          : `已提交 ${submitted} 项转码任务`
      )
      setSelected(new Set())
      loadCandidates()
      onSubmitted()
    } catch (e: any) {
      toastRef.current.error(e?.response?.data?.error || '批量提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="rounded-xl"
      style={{ background: 'var(--glass-bg)', border: '1px solid var(--neon-blue-6)' }}
    >
      {/* 折叠头 */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-white/5 transition rounded-xl"
      >
        <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          <Film size={16} className="text-neon-blue" />
          选源提交转码
          {expanded && total > 0 && (
            <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
              （共 {total.toLocaleString()} 条）
            </span>
          )}
          {selected.size > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--neon-blue-15)', color: 'var(--neon-blue)' }}>
              已选 {selected.size}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          {!expanded && <span>点击展开 ↓</span>}
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {/* 主体 */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: 'var(--neon-blue-6)' }}>
          {/* 清晰度多选 + 提交按钮 */}
          <div className="flex items-center justify-between flex-wrap gap-2 pt-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>清晰度：</span>
              {TRANSCODE_QUALITIES.map((q) => {
                const active = qualities.has(q)
                const mbps = QUALITY_BITRATE_MBPS[q] ?? 0
                // 单档每分钟约 mbps * 60 / 8 MB
                const perMinMB = (mbps * 60) / 8
                return (
                  <button
                    key={q}
                    type="button"
                    onClick={() => toggleQuality(q)}
                    title={`${q} 约 ${mbps.toFixed(1)} Mbps · 每分钟约 ${perMinMB.toFixed(1)} MB`}
                    className={clsx(
                      'rounded-lg px-2.5 py-1 text-xs transition',
                      active && 'font-medium'
                    )}
                    style={active
                      ? { background: 'var(--neon-blue-15)', border: '1px solid var(--neon-blue-30)', color: 'var(--neon-blue)' }
                      : { background: 'var(--surface-glass-2)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
                  >
                    {q}
                  </button>
                )
              })}
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                超过原始分辨率的档位会自动跳过
              </span>
              {/* 已选影视 + 已选档位 → 估算本次产出，跨页选择时仅当前页可见部分参与计算 */}
              {estimatedSize > 0 && (
                <span
                  className="text-[11px] px-1.5 py-0.5 rounded"
                  style={{ background: 'var(--neon-blue-6)', color: 'var(--neon-blue)' }}
                  title="基于已选档位码率与影视时长估算，实际大小受编码器与场景复杂度影响（误差 ±20%）"
                >
                  预计本次产出 ≈ {formatSize(estimatedSize)}
                  {visibleSelectedCount < selected.size && '（仅当前页可估算）'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                disabled={selected.size === 0}
                className="text-xs px-2 py-1.5 rounded transition disabled:opacity-40"
                style={{ background: 'var(--surface-glass-2)', color: 'var(--text-secondary)' }}
              >
                清空
              </button>
              <button
                type="button"
                disabled={selected.size === 0 || qualities.size === 0 || submitting}
                onClick={handleSubmit}
                className="text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 transition disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'var(--neon-blue)', color: '#fff', boxShadow: '0 0 12px var(--neon-blue-30)' }}
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                提交转码（{selected.size}）
              </button>
            </div>
          </div>

          {/* 筛选行 */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <input
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setPage(1)
                    setKeyword(keywordInput.trim())
                  }
                }}
                placeholder="搜索标题 / 原名 / 番号，回车确认"
                className="w-full px-3 py-1.5 text-sm rounded-md outline-none"
                style={{ background: 'var(--surface-glass-2)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
              />
            </div>
            <select
              value={libraryID}
              onChange={(e) => { setPage(1); setLibraryID(e.target.value) }}
              className="px-2 py-1.5 text-sm rounded-md outline-none"
              style={{ background: 'var(--surface-glass-2)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
            >
              <option value="">全部媒体库</option>
              {libraries.map((lib) => (
                <option key={lib.id} value={lib.id}>{lib.name}</option>
              ))}
            </select>
            <select
              value={mediaType}
              onChange={(e) => { setPage(1); setMediaType(e.target.value) }}
              className="px-2 py-1.5 text-sm rounded-md outline-none"
              style={{ background: 'var(--surface-glass-2)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
            >
              <option value="">全部类型</option>
              <option value="movie">电影</option>
              <option value="episode">剧集</option>
            </select>
            <button
              type="button"
              onClick={() => loadCandidates()}
              disabled={loading}
              className="px-2 py-1.5 text-xs rounded-md flex items-center gap-1 transition"
              style={{ background: 'var(--surface-glass-2)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
              title="刷新"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              刷新
            </button>
          </div>

          {/* 列表 */}
          <div className="overflow-hidden rounded-lg" style={{ border: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center gap-2 px-3 py-2 text-xs" style={{ background: 'var(--surface-glass-2)', color: 'var(--text-muted)' }}>
              <button
                type="button"
                onClick={toggleSelectAll}
                className="flex items-center gap-1 hover:text-neon-blue transition"
                title="全选 / 取消全选当前页可选项"
              >
                {allSelectedOnPage ? <CheckSquare size={14} className="text-neon-blue" /> : <Square size={14} />}
                当前页全选
              </button>
              <span className="ml-auto">第 {page} / {totalPages || 1} 页</span>
            </div>

            {loading && candidates.length === 0 ? (
              <div className="p-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                <Loader2 size={16} className="inline animate-spin mr-2" />
                加载中...
              </div>
            ) : candidates.length === 0 ? (
              <div className="p-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                暂无匹配的影视
              </div>
            ) : (
              <ul className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                {candidates.map((c) => {
                  const disabled = c.is_strm
                  const checked = selected.has(c.media_id)
                  return (
                    <li
                      key={c.media_id}
                      className={clsx(
                        'flex items-center gap-3 px-3 py-2 transition',
                        !disabled && 'cursor-pointer hover:bg-white/5',
                        checked && 'bg-neon-blue/5'
                      )}
                      title={c.file_path}
                      onClick={() => {
                        if (disabled) return
                        const next = new Set(selected)
                        if (next.has(c.media_id)) next.delete(c.media_id)
                        else next.add(c.media_id)
                        setSelected(next)
                      }}
                    >
                      <div className="flex-shrink-0">
                        {disabled ? (
                          <Square size={14} className="opacity-30" />
                        ) : checked ? (
                          <CheckSquare size={14} className="text-neon-blue" />
                        ) : (
                          <Square size={14} style={{ color: 'var(--text-muted)' }} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                            {c.title || c.orig_title || '(无标题)'}
                          </span>
                          {c.media_type === 'episode' && (c.season_num || c.episode_num) ? (
                            <span
                              className="text-xs font-mono px-1.5 py-0.5 rounded"
                              style={{ background: 'var(--neon-blue-6)', color: 'var(--text-secondary)' }}
                            >
                              {`S${String(c.season_num ?? 0).padStart(2, '0')}E${String(c.episode_num ?? 0).padStart(2, '0')}`}
                            </span>
                          ) : null}
                          {c.year > 0 && (
                            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({c.year})</span>
                          )}
                          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-glass-2)', color: 'var(--text-muted)' }}>
                            {c.media_type === 'episode' ? '剧集' : '电影'}
                          </span>
                          {c.is_strm && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded text-amber-400" style={{ background: 'rgba(245,158,11,0.1)' }}>
                              STRM 不可转码
                            </span>
                          )}
                          {c.can_play_directly && !c.is_strm && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded text-emerald-400" style={{ background: 'rgba(16,185,129,0.1)' }}>
                              可直接播放
                            </span>
                          )}
                        </div>
                        <div className="text-xs mt-0.5 flex items-center gap-3 flex-wrap" style={{ color: 'var(--text-muted)' }}>
                          {c.resolution && <span>{c.resolution}</span>}
                          {c.video_codec && <span>{c.video_codec}</span>}
                          {c.audio_codec && <span>{c.audio_codec}</span>}
                          {c.duration > 0 && <span>{Math.round(c.duration / 60)} 分钟</span>}
                          {c.file_size > 0 && <span>{formatSize(c.file_size)}</span>}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* 分页 */}
          {total > pageSize && (
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={pageSize}
              pageSizeOptions={[12, 20, 50, 100]}
              onPageChange={setPage}
              onPageSizeChange={(s) => { setPage(1); setSize(s) }}
            />
          )}
        </div>
      )}
    </div>
  )
}
