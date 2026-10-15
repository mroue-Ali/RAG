import { GearSix, List, NotePencil, Plus, ShieldStar, SignOut, X } from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router'
import { cn } from '../../lib/cn'
import { statusLabel } from '../../lib/providers'
import { useAuth, useSettings } from '../../state/contexts'
import { useModelSummary } from '../../state/useModelSummary'
import { IconButton } from '../ui/Button'
import { buttonClass } from '../ui/buttonStyles'
import { StatusDot } from '../ui/StatusDot'
import { ConversationList } from './ConversationList'
import { ModelCard } from './ModelCard'
import { Wordmark } from './Wordmark'

const PAGES: { to: string; label: string; icon: Icon; superadmin?: boolean }[] = [
  { to: '/settings', label: 'Settings', icon: GearSix },
  { to: '/admin', label: 'Admin', icon: ShieldStar, superadmin: true },
]

/**
 * Primary navigation: a new chat, the saved conversations, the other pages, the
 * model and who is signed in. A column beside the page on wide screens; on
 * narrow ones a drawer that the menu button in the top bar opens.
 */
export function Sidebar() {
  const { session, signOut } = useAuth()
  const { dirty } = useSettings()
  const { status, provider } = useModelSummary()
  const [open, setOpen] = useState(false)
  const closeButton = useRef<HTMLButtonElement>(null)
  const close = () => setOpen(false)
  const modelStatus = `Model: ${statusLabel(status, provider).toLowerCase()}`
  const user = session.user!
  const pages = PAGES.filter((page) => !page.superadmin || user.is_superadmin)

  // An open drawer takes the focus, and Escape closes it.
  useEffect(() => {
    if (!open) return
    closeButton.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-sunken/60 px-3 md:hidden">
        <IconButton label="Open menu" onClick={() => setOpen(true)}>
          <List size={18} />
        </IconButton>
        <Wordmark />
        <span title={modelStatus} className="ml-auto flex px-1">
          <StatusDot status={status} />
          <span className="sr-only">{modelStatus}</span>
        </span>
        <Link to="/" aria-label="New chat" title="New chat" className={buttonClass('ghost', 'icon')}>
          <NotePencil size={18} />
        </Link>
      </header>

      {open && <div aria-hidden="true" className="fixed inset-0 z-30 bg-ink/40 md:hidden" onClick={close} />}

      <aside
        aria-label="Navigation"
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] flex-col border-r border-line bg-canvas p-3 duration-200',
          'md:visible md:static md:z-auto md:w-64 md:translate-x-0 md:bg-sunken/60 md:transition-none',
          // Shown at once on opening, so the close button can take the focus. On closing it
          // stays visible until it has slid away, and is then hidden from the keyboard too.
          open
            ? 'visible translate-x-0 shadow-raised transition-[translate]'
            : 'invisible -translate-x-full transition-[translate,visibility]',
        )}
      >
        <div className="flex h-11 shrink-0 items-center justify-between px-2">
          <Wordmark />
          <span className="md:hidden">
            <IconButton ref={closeButton} label="Close menu" onClick={close}>
              <X size={16} />
            </IconButton>
          </span>
        </div>

        <Link to="/" onClick={close} className={buttonClass('secondary', 'md', 'mt-3 w-full')}>
          <Plus size={15} weight="bold" />
          New chat
        </Link>

        <div className="-mx-3 mt-5 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <ConversationList onNavigate={close} />
        </div>

        <nav aria-label="Pages" className="flex flex-col gap-0.5 border-t border-line pt-3">
          {pages.map(({ to, label, icon: PageIcon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={close}
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
                  {label}
                  {to === '/settings' && dirty && <span className="ml-auto text-xs font-normal text-warn">Unsaved</span>}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-3 flex flex-col gap-3">
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
    </>
  )
}
