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
}

const widths = { md: 'max-w-md', xl: 'max-w-5xl' }

// Side panel instead of page navigation, so the list stays in context (design §8.0).
export function Drawer({ open, title, onClose, children, footer, size = 'md' }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cn(
          'relative flex h-full w-full flex-col',
          widths[size],
          'border-l border-border bg-surface shadow-xl animate-[slide-in_180ms_ease-out]',
        )}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="min-w-0 text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-surface-2" aria-label="close">
            <X className="size-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>}
      </aside>
    </div>
  )
}
