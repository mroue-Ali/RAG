import { StackSimple } from '@phosphor-icons/react'
import { useAuth } from '../../state/contexts'

export function Wordmark() {
  const { session } = useAuth()
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-7 place-items-center rounded-lg bg-ink text-canvas">
        <StackSimple size={16} weight="fill" />
      </span>
      <span className="font-mono text-[15px] font-medium tracking-tight">{session.app}</span>
    </div>
  )
}
