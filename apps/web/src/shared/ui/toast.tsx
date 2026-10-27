import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

type Toast = { id: number; message: string; tone: 'success' | 'error'; action?: { label: string; run: () => void } }
type ToastApi = (t: Omit<Toast, 'id'>) => void

const ToastContext = createContext<ToastApi>(() => {})

// Optimistic actions confirm with a toast + Undo instead of a modal (design §8.0).
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback<ToastApi>((t) => {
    const id = Date.now() + Math.random()
    setToasts((all) => [...all, { ...t, id }])
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), t.action ? 6000 : 3500)
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2" role="status">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex min-w-72 items-center gap-3 rounded-xl bg-fg px-4 py-3 text-sm text-bg shadow-lg',
            )}
          >
            {t.tone === 'success' ? (
              <CircleCheck className="size-4 text-status-done" aria-hidden />
            ) : (
              <CircleAlert className="size-4 text-status-risk" aria-hidden />
            )}
            <span className="flex-1">{t.message}</span>
            {t.action && (
              <button
                className="font-semibold text-brand"
                onClick={() => {
                  t.action!.run()
                  setToasts((all) => all.filter((x) => x.id !== t.id))
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
