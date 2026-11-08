import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  className?: string
}

// Centered popup that stacks above a Drawer/Sheet, so the page underneath stays put.
export function Modal({ title, onClose, children, className }: Props) {
  useEffect(() => {
    // Capture phase + stopPropagation: Escape closes only this popup, not the drawer below it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Portal to <body> so a transformed/draggable ancestor can't clip it; stop React events
  // bubbling back to whatever card opened it (portals still bubble through the React tree).
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-center sm:p-6"
      onClick={stop} onPointerDown={stop} onMouseDown={stop} onKeyDown={stop}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cn(// Full-screen sheet on phones; a centered card from sm up.
          'relative flex h-full w-full max-w-6xl flex-col overflow-hidden bg-bg shadow-2xl sm:h-auto sm:max-h-full sm:rounded-2xl sm:border sm:border-border', className)}
      >
        <header className="flex items-center justify-between gap-3 border-b border-border bg-surface py-2 pl-4 pr-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-5 sm:py-3">
          <h2 className="min-w-0 truncate text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 pointer-coarse:size-11" aria-label="close">
            <X className="size-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">{children}</div>
      </section>
    </div>,
    document.body,
  )
}
