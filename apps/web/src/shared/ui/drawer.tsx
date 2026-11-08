import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'xl'
  /** Which edge it slides from — 'left' for the mobile navigation menu. */
  side?: 'left' | 'right'
  className?: string
}

const widths = { md: 'max-w-md', xl: 'max-w-5xl' }
const sides = {
  right: 'border-l animate-[slide-in_180ms_ease-out]',
  left: 'border-r animate-[slide-in-left_180ms_ease-out]',
}

// Side panel instead of page navigation, so the list stays in context (design §8.0).
export function Drawer({ open, title, onClose, children, footer, size = 'md', side = 'right', className }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className={cn('fixed inset-0 z-40 flex', side === 'right' ? 'justify-end' : 'justify-start')}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cn(
          'relative flex h-full w-full flex-col',
          widths[size],
          'border-border bg-surface shadow-xl',
          sides[side],
          className,
        )}
      >
        <header className="flex items-center justify-between gap-2 border-b border-border py-3 pl-4 pr-2 sm:px-5 sm:py-4">
          <h2 className="min-w-0 text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 pointer-coarse:size-11" aria-label="close">
            <X className="size-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">{footer}</footer>}
      </aside>
    </div>
  )
}
