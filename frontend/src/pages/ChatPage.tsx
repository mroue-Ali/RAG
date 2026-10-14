import { Plus } from '@phosphor-icons/react'
import { useLayoutEffect, useRef } from 'react'
import { Link } from 'react-router'
import { Composer } from '../components/chat/Composer'
import { EmptyState } from '../components/chat/EmptyState'
import { MessageList } from '../components/chat/MessageList'
import { PageHeader } from '../components/layout/AppShell'
import { Button } from '../components/ui/Button'
import { buttonClass } from '../components/ui/buttonStyles'
import { isLocal, statusLabel } from '../lib/providers'
import { useCan, useChat, useModel } from '../state/contexts'
import { useModelSummary } from '../state/useModelSummary'

// Within this many pixels of the end counts as "reading the latest".
const PIN_THRESHOLD = 80

export function ChatPage() {
  const manage = useCan('model.manage')
  const { messages, clear } = useChat()
  const { load } = useModel()
  const { status, model, provider, configured } = useModelSummary()
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  // Follow the reply as it streams, unless the reader has scrolled up to look at something.
  useLayoutEffect(() => {
    const element = scroller.current
    if (element && pinned.current) element.scrollTop = element.scrollHeight
  }, [messages])

  const trackScroll = () => {
    const element = scroller.current
    if (!element) return
    pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < PIN_THRESHOLD
  }

  const ready = status === 'ready'
  // A local model has to be loaded; an API one only has to be filled in.
  const local = isLocal(provider)
  const loadable = manage && local && configured && status !== 'loading'
  const blocked = ready
    ? undefined
    : !manage
      ? 'Waiting for an admin to set up the model'
      : local
        ? 'Load a model to start chatting'
        : 'Set up a model to start chatting'
  return (
    <>
      <PageHeader title="Chat">
        {messages.length > 0 && (
          <Button size="sm" onClick={clear}>
            <Plus size={14} weight="bold" />
            New chat
          </Button>
        )}
      </PageHeader>

      <div ref={scroller} onScroll={trackScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-8 md:px-6">
          {messages.length > 0 ? <MessageList messages={messages} /> : <EmptyState />}
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4 md:px-6">
        {/* With messages on screen the empty state is gone, so say here why sending is off. */}
        {!ready && messages.length > 0 && (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-lg bg-sunken px-3 py-2 text-[13px] text-ink-muted">
            <span>Model: {statusLabel(status, provider).toLowerCase()}. Sending is paused.</span>
            {loadable ? (
              <Button size="sm" onClick={load}>
                Load model
              </Button>
            ) : (
              manage &&
              status !== 'loading' && (
                <Link to="/settings" className={buttonClass('secondary', 'sm')}>
                  Open settings
                </Link>
              )
            )}
          </div>
        )}
        <Composer blocked={blocked} model={model} onSend={() => (pinned.current = true)} />
      </div>
    </>
  )
}
