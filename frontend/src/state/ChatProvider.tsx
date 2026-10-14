import { useCallback, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { errorMessage, streamChat } from '../lib/api'
import { splitThinking } from '../lib/thinking'
import { ChatContext } from './contexts'
import type { Message } from './contexts'

let lastId = 0
const nextId = () => String(++lastId)

/**
 * The conversation lives here, above the router, so it survives a trip to
 * Settings and back. It is not persisted: a reload starts fresh.
 */
export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [streaming, setStreaming] = useState(false)
  const active = useRef<AbortController | null>(null)

  /** Ask the model to answer `conversation`, whose last message is the user's. */
  const answer = useCallback(async (conversation: Message[]) => {
    const reply: Message = { id: nextId(), role: 'assistant', content: '', pending: true }
    const patch = (change: (message: Message) => Message) =>
      setMessages((all) => all.map((message) => (message.id === reply.id ? change(message) : message)))

    const abort = new AbortController()
    active.current = abort
    setMessages([...conversation, reply])
    setStreaming(true)
    try {
      for await (const event of streamChat(toPayload(conversation), abort.signal)) {
        if (event.type === 'start') {
          patch((message) => ({ ...message, model: event.model }))
        } else if (event.type === 'delta') {
          patch((message) => ({ ...message, content: message.content + event.content }))
        } else if (event.type === 'reasoning') {
          patch((message) => ({ ...message, reasoning: (message.reasoning ?? '') + event.content }))
        } else if (event.type === 'error') {
          patch((message) => ({ ...message, error: event.message }))
        } else {
          patch((message) => ({
            ...message,
            stats: {
              finishReason: event.finish_reason,
              completionTokens: event.completion_tokens,
              seconds: event.seconds,
              generationSeconds: event.generation_seconds,
            },
          }))
        }
      }
    } catch (failure) {
      patch((message) =>
        abort.signal.aborted ? { ...message, stopped: true } : { ...message, error: errorMessage(failure) },
      )
    } finally {
      patch((message) => ({ ...message, pending: false }))
      // A newer request may already own these; leave them alone if so.
      if (active.current === abort) {
        active.current = null
        setStreaming(false)
      }
    }
  }, [])

  const stop = useCallback(() => active.current?.abort(), [])

  const value = useMemo(
    () => ({
      messages,
      streaming,
      stop,
      send: (text: string) => void answer([...messages, { id: nextId(), role: 'user', content: text }]),
      regenerate: () => {
        if (messages.at(-1)?.role === 'assistant') void answer(messages.slice(0, -1))
      },
      clear: () => {
        active.current?.abort()
        active.current = null
        setStreaming(false)
        setMessages([])
      },
    }),
    [messages, streaming, stop, answer],
  )

  return <ChatContext value={value}>{children}</ChatContext>
}

/**
 * What the model gets to see: completed question and answer pairs, then the new
 * question. A question whose reply failed is left out, because many chat
 * templates reject two user turns in a row. Inline reasoning is dropped too.
 */
function toPayload(conversation: Message[]) {
  const question = conversation[conversation.length - 1]
  const earlier = conversation.slice(0, -1)
  const payload: { role: 'user' | 'assistant'; content: string }[] = []
  for (let index = 0; index + 1 < earlier.length; index++) {
    const [asked, replied] = [earlier[index], earlier[index + 1]]
    if (asked.role !== 'user' || replied.role !== 'assistant') continue
    const { answer } = splitThinking(replied.content)
    if (!answer.trim()) continue
    payload.push({ role: 'user', content: asked.content }, { role: 'assistant', content: answer })
    index++
  }
  payload.push({ role: 'user', content: question.content })
  return payload
}
