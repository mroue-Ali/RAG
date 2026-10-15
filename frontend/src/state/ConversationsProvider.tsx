import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, errorMessage } from '../lib/api'
import { moveToTop } from '../lib/conversations'
import type { ChatEvent, ConversationInfo, MessageInfo, MessageRole } from '../lib/types'
import { ConversationsContext, EMPTY_THREAD, threadKey, useModel } from './contexts'
import type { Message, Thread } from './contexts'

// The thread of the conversation being started, until the server gives it an id.
const NEW = threadKey(null)

let lastDraft = 0

/** A message the server has not stored yet. */
function draft(role: MessageRole, content = ''): Message {
  return {
    key: `draft-${++lastDraft}`,
    id: null,
    role,
    content,
    reasoning: '',
    status: 'complete',
    error: null,
    model: null,
    stats: null,
  }
}

// The two helpers below are out here rather than inline because the React Compiler
// cannot tell that a `change` passed in leaves the old state alone.

/** A state update that changes one thread. One removed meanwhile, with its conversation, stays gone. */
function patching(key: string, change: (thread: Thread) => Thread) {
  return (all: Record<string, Thread>) =>
    all[key] || key === NEW ? { ...all, [key]: change(all[key] ?? EMPTY_THREAD) } : all
}

/** The thread with one of its messages changed. */
function changingMessage(thread: Thread, key: string, change: (message: Message) => Message): Thread {
  return { ...thread, messages: thread.messages.map((message) => (message.key === key ? change(message) : message)) }
}

function fromServer(info: MessageInfo, key = String(info.id)): Message {
  const { id, role, content, reasoning, status, error, model, stats } = info
  return { key, id, role, content, reasoning, status, error, model, stats }
}

interface StreamOptions {
  /** A new question, shown at once and swapped for the stored copy when the server confirms it. */
  question?: Message
  /** The reply this one replaces. Put back if the request is refused. */
  replacing?: Message
  /** Called with the conversation's id when the server confirms the question. */
  onStart?: (id: number) => void
}

/**
 * The signed-in user's conversations, and the messages of each one opened so
 * far. Lives above the router, so a reply keeps streaming into its
 * conversation while you look at another one.
 */
export function ConversationsProvider({ children }: { children: ReactNode }) {
  const { offline } = useModel()
  const [list, setList] = useState<ConversationInfo[] | null>(null)
  const [threads, setThreads] = useState<Record<string, Thread>>({})
  // Threads fetched or being fetched, so opening one twice asks the server once.
  const fetched = useRef(new Set<string>())
  // How to stop each reply that is being written, by thread.
  const streams = useRef(new Map<string, AbortController>())

  // Runs again when the backend comes back, in case the first attempt found it down.
  const missing = list === null
  useEffect(() => {
    if (offline || !missing) return
    let current = true
    api.conversations().then(
      (conversations) => {
        if (current) setList(conversations)
      },
      () => {},
    )
    return () => {
      current = false
    }
  }, [offline, missing])

  const patch = useCallback((key: string, change: (thread: Thread) => Thread) => setThreads(patching(key, change)), [])

  const open = useCallback(
    (id: number) => {
      const key = threadKey(id)
      if (fetched.current.has(key)) return
      fetched.current.add(key)
      setThreads((all) => ({ ...all, [key]: { ...(all[key] ?? EMPTY_THREAD), loading: true, error: null } }))
      api.conversation(id).then(
        ({ messages, ...info }) => {
          patch(key, (thread) => ({ ...thread, loading: false, messages: messages.map((message) => fromServer(message)) }))
          // Started elsewhere after the list was fetched: list it too.
          setList((current) => current && (current.some((other) => other.id === id) ? current : [...current, info]))
        },
        (failure) => {
          fetched.current.delete(key)
          patch(key, (thread) => ({ ...thread, loading: false, error: errorMessage(failure) }))
        },
      )
    },
    [patch],
  )

  /** Stream a reply into a thread, from the request's events. */
  const stream = useCallback(
    async (
      start: string,
      request: (signal: AbortSignal) => AsyncGenerator<ChatEvent>,
      { question, replacing, onStart }: StreamOptions,
    ) => {
      // Changes from NEW to the conversation's id once the server has created it.
      let key = start
      let confirmed = false
      const reply = draft('assistant')
      const abort = new AbortController()
      streams.current.set(key, abort)

      const patchReply = (change: (message: Message) => Message) =>
        patch(key, (thread) => changingMessage(thread, reply.key, change))

      patch(key, (thread) => ({
        ...thread,
        streaming: true,
        notSent: null,
        messages: [
          ...thread.messages.filter((message) => message.key !== replacing?.key),
          ...(question ? [question] : []),
          { ...reply, pending: true },
        ],
      }))

      try {
        for await (const event of request(abort.signal)) {
          if (event.type === 'start') {
            confirmed = true
            const id = event.conversation.id
            if (key === NEW) {
              const saved = String(id)
              setThreads(({ [NEW]: thread, ...rest }) => ({ ...rest, [saved]: thread }))
              streams.current.delete(NEW)
              streams.current.set(saved, abort)
              fetched.current.add(saved)
              key = saved
            }
            patch(key, (thread) => ({
              ...thread,
              messages: thread.messages.map((message) =>
                message.key === question?.key
                  ? fromServer(event.question, message.key)
                  : message.key === reply.key
                    ? { ...message, model: event.model }
                    : message,
              ),
            }))
            setList((current) => current && moveToTop(current, event.conversation))
            onStart?.(id)
          } else if (event.type === 'delta') {
            patchReply((message) => ({ ...message, content: message.content + event.content }))
          } else if (event.type === 'reasoning') {
            patchReply((message) => ({ ...message, reasoning: message.reasoning + event.content }))
          } else if (event.reply) {
            const stored = event.reply
            patchReply(() => fromServer(stored, reply.key))
          }
        }
      } catch (failure) {
        const stopped = abort.signal.aborted
        if (!confirmed) {
          // Refused before anything was stored: take the new messages back out and say why.
          patch(key, (thread) => ({
            ...thread,
            notSent: stopped ? null : errorMessage(failure),
            messages: [
              ...thread.messages.filter((message) => message.key !== reply.key && message.key !== question?.key),
              ...(replacing ? [replacing] : []),
            ],
          }))
        } else {
          patchReply((message) =>
            stopped ? { ...message, status: 'stopped' } : { ...message, status: 'error', error: errorMessage(failure) },
          )
        }
      } finally {
        patchReply((message) => ({ ...message, pending: false }))
        patch(key, (thread) => ({ ...thread, streaming: false }))
        if (streams.current.get(key) === abort) streams.current.delete(key)
      }
    },
    [patch],
  )

  const send = useCallback(
    (id: number | null, text: string) =>
      new Promise<number | null>((resolve) => {
        const question = draft('user', text)
        void stream(threadKey(id), (signal) => api.ask(id, text, signal), { question, onStart: resolve }).finally(() =>
          // Does nothing if onStart has resolved it already.
          resolve(null),
        )
      }),
    [stream],
  )

  const regenerate = useCallback(
    (id: number, reply: Message) => void stream(threadKey(id), (signal) => api.regenerate(id, signal), { replacing: reply }),
    [stream],
  )

  const stop = useCallback((id: number | null) => streams.current.get(threadKey(id))?.abort(), [])

  const rename = useCallback(async (id: number, title: string) => {
    const renamed = await api.renameConversation(id, title)
    setList((current) => current && current.map((conversation) => (conversation.id === id ? renamed : conversation)))
  }, [])

  const remove = useCallback(async (id: number) => {
    const key = threadKey(id)
    streams.current.get(key)?.abort()
    await api.deleteConversation(id)
    setList((current) => current && current.filter((conversation) => conversation.id !== id))
    setThreads((all) => {
      const rest = { ...all }
      delete rest[key]
      return rest
    })
    fetched.current.delete(key)
  }, [])

  const value = useMemo(
    () => ({ list, threads, open, send, regenerate, stop, rename, remove }),
    [list, threads, open, send, regenerate, stop, rename, remove],
  )

  return <ConversationsContext value={value}>{children}</ConversationsContext>
}
