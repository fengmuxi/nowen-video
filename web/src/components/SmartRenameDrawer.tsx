import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Wand2 } from 'lucide-react'
import type { Library } from '@/types'
import { getLibraryPaths } from '@/types'
import SmartRenamePanel from './SmartRenamePanel'

export interface SmartRenameDrawerProps {
  open: boolean
  library: Library | null
  onClose: () => void
}

/**
 * 智能扫描重命名抽屉
 * - 右侧 80vw 抽屉，避免与"确认落盘"二级 Modal 嵌套冲突
 * - 标题区由抽屉头部承担，Panel 隐藏自身 header
 * - 接收 library 注入扫描根目录候选
 */
export default function SmartRenameDrawer({ open, library, onClose }: SmartRenameDrawerProps) {
  // ESC 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // 锁定背景滚动
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  const paths = library ? getLibraryPaths(library) : []
  const defaultPath = paths[0] || library?.path || ''

  return (
    <AnimatePresence>
      {open && library && (
        <motion.div
          key="smart-rename-drawer-root"
          className="fixed inset-0 z-50 flex"
          initial={{ pointerEvents: 'none' }}
          animate={{ pointerEvents: 'auto' }}
          exit={{ pointerEvents: 'none' }}
        >
          {/* 遮罩 */}
          <motion.div
            className="absolute inset-0 backdrop-blur-sm"
            style={{ background: 'var(--bg-overlay)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* 抽屉主体 */}
          <motion.aside
            className="ml-auto h-full w-full md:w-[80vw] flex flex-col relative"
            style={{
              background: 'var(--bg-base)',
              borderLeft: '1px solid var(--border-default)',
              boxShadow: 'var(--shadow-elevated)',
            }}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <header
              className="flex items-center gap-3 px-6 py-4 flex-shrink-0"
              style={{ borderBottom: '1px solid var(--border-default)' }}
            >
              <div
                className="flex h-9 w-9 items-center justify-center rounded-lg"
                style={{
                  background: 'var(--neon-blue-10)',
                  color: 'var(--neon-blue)',
                  border: '1px solid var(--neon-blue-20)',
                }}
              >
                <Wand2 size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <h2
                  className="text-base font-semibold truncate"
                  style={{ color: 'var(--text-primary)' }}
                >
                  智能扫描重命名
                </h2>
                <p
                  className="text-xs truncate"
                  style={{ color: 'var(--text-tertiary)' }}
                  title={defaultPath}
                >
                  媒体库：<span style={{ color: 'var(--text-secondary)' }}>{library.name}</span>
                  {defaultPath && (
                    <>
                      <span className="mx-1.5">·</span>
                      <span className="font-mono">{defaultPath}</span>
                    </>
                  )}
                </p>
              </div>
              <button
                onClick={onClose}
                className="rounded-lg p-2 transition-colors hover:bg-[var(--nav-hover-bg)]"
                style={{ color: 'var(--text-tertiary)' }}
                title="关闭 (Esc)"
              >
                <X size={18} />
              </button>
            </header>

            {/* 内容（滚动区） */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <SmartRenamePanel
                defaultPath={defaultPath}
                candidatePaths={paths}
                showHeader={false}
                compact
              />
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
