import { ChatCircleText, GearSix, ShieldStar, SignOut } from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import { NavLink } from 'react-router'
import { cn } from '../../lib/cn'
import { statusLabel } from '../../lib/providers'
import { useAuth, useSettings } from '../../state/contexts'
import { useModelSummary } from '../../state/useModelSummary'
import { IconButton } from '../ui/Button'
import { StatusDot } from '../ui/StatusDot'
import { ModelCard } from './ModelCard'
import { Wordmark } from './Wordmark'

const PAGES: { to: string; label: string; icon: Icon; superadmin?: boolean }[] = [
  { to: '/', label: 'Chat', icon: ChatCircleText },
  { to: '/settings', label: 'Settings', icon: GearSix },
  { to: '/admin', label: 'Admin', icon: ShieldStar, superadmin: true },
]

/** Primary navigation: a rail beside the page on wide screens, a bar above it on narrow ones. */
export function Sidebar() {
  const { session, signOut } = useAuth()
  const { dirty } = useSettings()
  const { status, provider } = useModelSummary()
  const modelStatus = `Model: ${statusLabel(status, provider).toLowerCase()}`
  const user = session.user!
  const pages = PAGES.filter((page) => !page.superadmin || user.is_superadmin)

  return (
    <aside className="flex shrink-0 items-center gap-1 border-b border-line bg-sunken/60 px-3 py-2 md:w-60 md:flex-col md:items-stretch md:gap-0 md:border-r md:border-b-0 md:p-3">
      <div className="px-1 md:flex md:h-11 md:items-center md:px-2">
        <Wordmark />
      </div>

      <nav aria-label="Pages" className="ml-auto flex gap-1 md:mt-4 md:ml-0 md:flex-col md:gap-0.5">
        {pages.map(({ to, label, icon: PageIcon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            aria-label={label}
            className={({ isActive }) =>
              cn(
                'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors',
                isActive ? 'bg-raised text-ink shadow-raised' : 'text-ink-muted hover:bg-raised/60 hover:text-ink',
              )
            }
          >
            {({ isActive }) => (
              <>
                <PageIcon size={18} weight={isActive ? 'fill' : 'regular'} />
                {/* Three labels do not fit a phone's top bar; the icons carry it there. */}
                <span className={cn(pages.length > 2 && 'hidden sm:inline')}>{label}</span>
                {to === '/settings' && dirty && (
                  <span className="ml-auto hidden text-xs font-normal text-warn md:inline">Unsaved</span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="ml-2 flex items-center gap-1 md:hidden">
        <span title={modelStatus} className="flex px-1">
          <StatusDot status={status} />
          <span className="sr-only">{modelStatus}</span>
        </span>
        <IconButton label="Sign out" onClick={signOut}>
          <SignOut size={16} />
        </IconButton>
      </div>

      <div className="mt-auto hidden flex-col gap-3 md:flex">
        <ModelCard />
        <div className="flex items-center justify-between gap-2 pl-2">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium" title={user.username}>
              {user.display_name}
            </p>
            <p className="truncate text-xs text-ink-faint">{session.account?.name}</p>
          </div>
          <IconButton label="Sign out" onClick={signOut}>
            <SignOut size={16} />
          </IconButton>
        </div>
      </div>
    </aside>
  )
}
