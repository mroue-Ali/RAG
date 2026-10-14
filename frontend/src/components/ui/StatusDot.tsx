import { cn } from '../../lib/cn'
import type { LLMState } from '../../lib/types'

const TONES: Record<LLMState['status'], string> = {
  ready: 'bg-accent',
  loading: 'bg-warn animate-pulse',
  error: 'bg-danger',
  unloaded: 'border border-ink-faint',
}

/** The model's state as a dot. Always paired with text that says the same thing. */
export function StatusDot({ status, className }: { status: LLMState['status']; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', TONES[status], className)} />
}
