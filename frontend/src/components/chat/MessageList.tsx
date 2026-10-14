import { ArrowsClockwise, CaretRight, Warning } from '@phosphor-icons/react'
import { formatSeconds } from '../../lib/format'
import { splitThinking } from '../../lib/thinking'
import { useChat, useSettings } from '../../state/contexts'
import type { Message, MessageStats } from '../../state/contexts'
import { IconButton } from '../ui/Button'
import { CopyButton } from '../ui/CopyButton'
import { Markdown } from './Markdown'

export function MessageList({ messages }: { messages: Message[] }) {
  return (
    <div className="flex flex-col gap-8">
      {messages.map((message, index) =>
        message.role === 'user' ? (
          <UserMessage key={message.id} message={message} />
        ) : (
          <AssistantMessage key={message.id} message={message} last={index === messages.length - 1} />
        ),
      )}
    </div>
  )
}

function UserMessage({ message }: { message: Message }) {
  return (
    <article
      aria-label="You"
      dir="auto"
      className="ml-auto max-w-[85%] rounded-xl bg-sunken px-4 py-2.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap"
    >
      {message.content}
    </article>
  )
}

function AssistantMessage({ message, last }: { message: Message; last: boolean }) {
  const { saved } = useSettings()
  const { regenerate, streaming } = useChat()

  const inline = splitThinking(message.content)
  const reasoning = [message.reasoning, inline.reasoning].filter(Boolean).join('\n\n')
  const answer = inline.answer
  const waiting = Boolean(message.pending) && !answer
  const empty = !message.pending && !answer && !message.error && !message.stopped

  return (
    <article className="flex flex-col gap-2">
      <header className="text-xs font-medium text-ink-muted">
        {saved?.general.assistant_name.trim() || 'Assistant'}
      </header>

      {reasoning && <Reasoning text={reasoning} active={waiting} />}
      {answer && <Markdown text={answer} />}
      {waiting && !reasoning && <span className="caret" role="status" aria-label="Waiting for the model" />}
      {empty && <p className="text-ink-muted">The model returned an empty reply.</p>}

      {message.error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">
          <Warning size={16} className="mt-0.5 shrink-0" />
          {message.error}
        </p>
      )}

      {!message.pending && (
        <footer className="-ml-2 flex min-h-8 flex-wrap items-center gap-x-1 gap-y-1">
          {answer && <CopyButton text={answer} label="Copy reply" />}
          {last && !streaming && (
            <IconButton label="Regenerate" onClick={regenerate}>
              <ArrowsClockwise size={15} />
            </IconButton>
          )}
          <Meta message={message} />
        </footer>
      )}
    </article>
  )
}

/** The model's thinking, folded away by default. */
function Reasoning({ text, active }: { text: string; active: boolean }) {
  return (
    <details className="group text-[13px] text-ink-muted">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg py-1 pr-2 hover:text-ink">
        <CaretRight size={12} weight="bold" className="transition-transform group-open:rotate-90" />
        {active ? 'Thinking' : 'Reasoning'}
        {active && <span className="caret" />}
      </summary>
      <p className="mt-1 ml-1.5 border-l-2 border-line pl-4 leading-relaxed whitespace-pre-wrap">{text}</p>
    </details>
  )
}

function Meta({ message }: { message: Message }) {
  const parts = [message.model, ...(message.stats ? describe(message.stats) : [])]
  if (message.stopped) parts.push('stopped')
  return (
    <p className="ml-2 flex flex-wrap gap-x-3 font-mono text-xs text-ink-faint">
      {parts.filter(Boolean).map((part) => (
        <span key={part}>{part}</span>
      ))}
    </p>
  )
}

function describe(stats: MessageStats): string[] {
  const parts: string[] = []
  if (stats.completionTokens) {
    parts.push(`${stats.completionTokens} tokens`)
    // Too short a burst gives a meaningless rate.
    if (stats.generationSeconds && stats.generationSeconds >= 0.2) {
      parts.push(`${Math.round(stats.completionTokens / stats.generationSeconds)} tok/s`)
    }
  }
  parts.push(formatSeconds(stats.seconds))
  if (stats.finishReason === 'length') parts.push('cut off at the length limit')
  return parts
}
