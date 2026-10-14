import { cn } from '../../lib/cn'
import { ROLES } from '../../lib/roles'
import type { Role } from '../../lib/types'

export function RoleBadge({ role, className }: { role: Role; className?: string }) {
  return (
    <span
      title={ROLES[role].description}
      className={cn(
        'inline-flex h-5 items-center rounded-full px-2 text-xs font-medium',
        role === 'member' ? 'bg-sunken text-ink-muted' : 'bg-accent/12 text-accent',
        className,
      )}
    >
      {ROLES[role].label}
    </span>
  )
}

export function SuperadminBadge() {
  return (
    <span
      title="Runs this instance, above every account."
      className="inline-flex h-5 items-center rounded-full bg-warn/12 px-2 text-xs font-medium text-warn"
    >
      Superadmin
    </span>
  )
}
