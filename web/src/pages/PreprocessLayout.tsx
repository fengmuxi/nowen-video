import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Zap, Subtitles } from 'lucide-react'
import clsx from 'clsx'

/**
 * 预处理模块壳组件
 * - 顶部一级 Tab：视频预处理 / 字幕预处理
 * - 下挂 <Outlet />：分别渲染 PreprocessPage 与 SubtitlePreprocessPage
 *
 * 设计要点：
 * 1) 路由级 Tab，URL 与页面状态强一致，浏览器前进/后退、刷新、深链分享均工作正常
 * 2) 不嵌套大组件，避免 PreprocessPage(113KB) 与 SubtitlePreprocessPage(44KB) 同屏挂载
 * 3) 子页面保持独立，WS 订阅自然按 Tab 切换 mount/unmount
 */
export default function PreprocessLayout() {
  const location = useLocation()
  // 子 Tab 命中：以路径前缀判定
  const isSubtitle = location.pathname.startsWith('/preprocess/subtitle')
  const isVideo = !isSubtitle

  const tabs = [
    { to: '/preprocess', label: '视频预处理', icon: Zap, active: isVideo, end: true },
    { to: '/preprocess/subtitle', label: '字幕预处理', icon: Subtitles, active: isSubtitle, end: false },
  ] as const

  return (
    <div className="space-y-3">
      {/* 一级 Tab 头：模块切换
          - 背景使用 var(--bg-elevated)：暗色下半透明深底，亮色下纯白，与正文背景天然过渡
          - 配合 backdrop-blur 让滚动内容透出柔和质感，亮/暗双模均不刺眼 */}
      <div
        className="sticky top-0 z-10 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-2 backdrop-blur-md"
        style={{
          background: 'var(--bg-elevated)',
          borderBottom: '1px solid var(--border-default)',
        }}
      >
        <div className="flex items-center gap-1 flex-wrap">
          {tabs.map((t) => {
            const Icon = t.icon
            return (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-all duration-200',
                  t.active && 'font-medium',
                )}
                style={t.active
                  ? { background: 'var(--neon-blue-15)', border: '1px solid var(--neon-blue-30)', color: 'var(--text-primary)' }
                  : { background: 'var(--glass-bg)', border: '1px solid var(--neon-blue-6)', color: 'var(--text-muted)' }}
              >
                <Icon size={14} className={t.active ? 'text-neon-blue' : ''} />
                <span>{t.label}</span>
              </NavLink>
            )
          })}
        </div>
      </div>

      {/* 子路由出口 */}
      <Outlet />
    </div>
  )
}
