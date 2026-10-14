import { useId } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/cn'

// Sets no width and no font size on purpose. Callers pass those, and two utilities
// for one property would leave the winner to stylesheet order. Inside a Field the
// control stretches to full width by itself, and text inherits the body size.
const CONTROL =
  'rounded-lg border border-line-strong bg-surface text-ink placeholder:text-ink-faint ' +
  'transition-colors hover:border-ink-faint disabled:opacity-50'

interface FieldProps {
  label: string
  hint?: ReactNode
  error?: ReactNode
  /** Receives the id that ties the label to the control. */
  children: (id: string) => ReactNode
  className?: string
}

/** Label above, control, then helper or error text below. */
export function Field({ label, hint, error, children, className }: FieldProps) {
  const id = useId()
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="text-[13px] text-danger">{error}</p>
      ) : (
        hint && <p className="text-[13px] text-ink-muted">{hint}</p>
      )}
    </div>
  )
}

export function TextInput({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(CONTROL, 'h-9 px-3', className)} {...props} />
}

interface NumberInputProps extends Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'min' | 'max'> {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}

/** A whole-number input. Typing is free; leaving the field snaps the value into range. */
export function NumberInput({ value, min, max, onChange, className, ...props }: NumberInputProps) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={Number.isFinite(value) ? value : ''}
      onChange={(event) => onChange(event.target.valueAsNumber)}
      onBlur={() => onChange(Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min)}
      className={cn(CONTROL, 'h-9 px-3 font-mono tabular-nums', className)}
      {...props}
    />
  )
}

export function TextArea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(CONTROL, 'resize-y px-3 py-2 leading-relaxed', className)} {...props} />
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(CONTROL, 'h-9 px-2.5', className)} {...props} />
}
