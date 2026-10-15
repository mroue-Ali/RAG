import { NavLink } from 'react-router'
import { cn } from '../../lib/cn'
import { groupByRecency } from '../../lib/conversations'
import { threadKey, useConversations } from '../../state/contexts'

/** The signed-in user's conversations, newest activity first, grouped by when. */
export function ConversationList({ onNavigate }: { onNavigate: () => void }) {
  const { list, threads } = useConversations()

  if (list === null) {
    return (
      <div className="flex flex-col gap-2 px-2 pt-2" aria-busy="true" aria-label="Loading conversations">
        <div className="shimmer h-4 w-4/5 rounded-lg" />
        <div className="shimmer h-4 w-3/5 rounded-lg" />
        <div className="shimmer h-4 w-2/3 rounded-lg" />
      </div>
    )
  }
  if (list.length === 0) {
    return <p className="px-2 pt-2 text-xs text-ink-faint">Your conversations will be listed here.</p>
  }

  return (
    <nav aria-label="Conversations" className="flex flex-col gap-4">
      {groupByRecency(list).map((group) => (
        <section key={group.label}>
          <h2 className="px-2 pb-1 text-xs font-medium text-ink-faint">{group.label}</h2>
          <ul className="flex flex-col gap-px">
            {group.conversations.map((conversation) => {
              const writing = threads[threadKey(conversation.id)]?.streaming
              return (
                <li key={conversation.id}>
                  <NavLink
                    to={`/c/${conversation.id}`}
                    onClick={onNavigate}
                    title={conversation.title}
                    className={({ isActive }) =>
                      cn(
                        'flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] transition-colors',
                        isActive ? 'bg-raised text-ink shadow-raised' : 'text-ink-muted hover:bg-raised/60 hover:text-ink',
                      )
                    }
                  >
                    <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
                    {writing && (
                      <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" title="Writing a reply">
                        <span className="sr-only">Writing a reply</span>
                      </span>
                    )}
                  </NavLink>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </nav>
  )
}
