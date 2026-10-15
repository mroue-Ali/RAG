import { useEffect, useLayoutEffect, useRef } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { Composer } from '../components/chat/Composer'
import { ConversationHeader } from '../components/chat/ConversationHeader'
import { EmptyState } from '../components/chat/EmptyState'
import { MessageList } from '../components/chat/MessageList'
import { PageHeader } from '../components/layout/AppShell'
import { Button } from '../components/ui/Button'
import { buttonClass } from '../components/ui/buttonStyles'
import { isLocal, statusLabel } from '../lib/providers'
import { useCan, useConversations, useModel, useThread } from '../state/contexts'
import type { Message } from '../state/contexts'
import { useModelSummary } from '../state/useModelSummary'

// Within this many pixels of the end counts as "reading the latest".
const PIN_THRESHOLD = 80
const NO_MESSAGES: Message[] = []

/** `/` starts a new conversation; `/c/:conversationId` shows a saved one. */
export function ChatPage() {
  const { conversationId } = useParams()
  if (conversationId === undefined) return <Conversation key="new" id={null} />
  const id = Number(conversationId)
  if (!Number.isSafeInteger(id) || id < 1) return <Navigate to="/" replace />
  // Keyed, so each conversation starts with its own scroll position and an empty composer.
  return <Conversation key={id} id={id} />
}

function Conversation({ id }: { id: number | null }) {
  const manage = useCan('model.manage')
  const { load } = useModel()
  const { status, model, provider, configured } = useModelSummary()
  const { list, open, send, stop, regenerate, rename, remove } = useConversations()
  const thread = useThread(id)
  const messages = thread?.messages ?? NO_MESSAGES
  const navigate = useNavigate()
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  // Whether this page is still on screen, for the move to a new conversation's address.
  const showing = useRef(false)

  useEffect(() => {
    showing.current = true
    return () => {
      showing.current = false
    }
  }, [])

  useEffect(() => {
    if (id !== null) open(id)
  }, [id, open])

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

  const onSend = async (text: string) => {
    pinned.current = true
    const saved = await send(id, text)
    // The first question created the conversation: take its address, unless the reader has moved on.
    if (id === null && saved !== null && showing.current) navigate(`/c/${saved}`, { replace: true })
    return saved !== null
  }

  const title = id === null ? 'New chat' : (list?.find((conversation) => conversation.id === id)?.title ?? '')
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

  if (thread?.error) {
    return (
      <>
        <PageHeader title={title || 'Conversation'} />
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 md:px-6">
          <div className="my-auto flex max-w-md flex-col gap-3 text-[15px] leading-relaxed text-ink-muted">
            <h2 className="text-xl font-semibold tracking-tight text-ink">This conversation could not be opened</h2>
            <p>{thread.error}</p>
            <div className="mt-2">
              <Link to="/" className={buttonClass()}>
                Start a new chat
              </Link>
            </div>
          </div>
        </div>
      </>
    )
  }

  const loading = !thread || (thread.loading && messages.length === 0)
  const streaming = thread?.streaming ?? false
  return (
    <>
      {id === null ? (
        <PageHeader title={title} />
      ) : (
        <ConversationHeader
          title={title}
          onRename={(next) => rename(id, next)}
          onDelete={async () => {
            await remove(id)
            navigate('/', { replace: true })
          }}
        />
      )}

      <div ref={scroller} onScroll={trackScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-8 md:px-6">
          {loading ? (
            <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading the conversation">
              <div className="shimmer ml-auto h-10 w-2/5 rounded-xl" />
              <div className="flex flex-col gap-2">
                <div className="shimmer h-4 w-full rounded-lg" />
                <div className="shimmer h-4 w-4/5 rounded-lg" />
                <div className="shimmer h-4 w-3/5 rounded-lg" />
              </div>
            </div>
          ) : messages.length > 0 ? (
            <MessageList
              messages={messages}
              streaming={streaming}
              onRegenerate={id === null ? undefined : (reply) => regenerate(id, reply)}
            />
          ) : (
            <EmptyState />
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4 md:px-6">
        {thread?.notSent && (
          <p role="alert" className="mb-2 rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">
            Your message was not sent. {thread.notSent}
          </p>
        )}
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
        <Composer
          blocked={loading ? 'Loading the conversation' : blocked}
          model={model}
          streaming={streaming}
          onSend={onSend}
          onStop={() => stop(id)}
        />
      </div>
    </>
  )
}
