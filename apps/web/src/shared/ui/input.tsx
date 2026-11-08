import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { cn } from '@/lib/utils'

const control =
  // 16px text on touch screens stops iOS Safari zooming into the field on focus.
  'h-9 w-full rounded-lg border border-border bg-surface px-3 text-fg placeholder:text-muted pointer-coarse:h-11 pointer-coarse:text-base ' +
  'focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand transition-shadow'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(control, className)} {...props} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...props },
  ref,
) {
  return <select ref={ref} className={cn(control, 'pr-8', className)} {...props} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(control, 'h-auto min-h-20 py-2 pointer-coarse:h-auto', className)} {...props} />
})

type FieldProps = { label: string; hint?: string; children: (id: string) => ReactNode; className?: string }

export function Field({ label, hint, children, className }: FieldProps) {
  const id = useId()
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-fg">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  )
}
