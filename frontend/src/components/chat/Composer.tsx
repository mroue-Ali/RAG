import { ArrowUp, Stop } from '@phosphor-icons/react'
import { useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { cn } from '../../lib/cn'
import { useChat } from '../../state/contexts'

interface ComposerProps {
  /** Why sending is off right now, shown in place of the prompt. Leave out when a model is ready. */
  blocked?: string
  model: string
  onSend: () => void
}

export function Composer({ blocked, model, onSend }: ComposerProps) {
  const disabled = blocked !== undefined
  const { send, stop, streaming } = useChat()
  const [text, setText] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)

  // Grow with the text, up to the max height set in CSS.
  useLayoutEffect(() => {
    const element = field.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [text])

  const canSend = !disabled && !streaming && text.trim() !== ''
  const submit = () => {
    if (!canSend) return
    send(text.trim())
    setText('')
    onSend()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter breaks the line. Leave Enter alone while an IME is composing.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div
      className={cn(
        'rounded-xl border border-line-strong bg-surface shadow-raised transition-colors',
        'focus-within:border-ink-faint',
        disabled && 'opacity-60',
      )}
    >
      <textarea
        ref={field}
        rows={1}
        value={text}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        aria-label="Message"
        dir="auto"
        placeholder={blocked ?? 'Write a message'}
        className="block max-h-52 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-relaxed placeholder:text-ink-faint focus-visible:outline-none"
      />
      <div className="flex items-center justify-between gap-3 py-2 pr-2 pl-4">
        <p className="truncate font-mono text-xs text-ink-faint">{model}</p>
        {streaming ? (
          <button
            type="button"
            onClick={stop}
            aria-label="Stop generating"
            title="Stop generating"
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-ink text-canvas transition-transform active:translate-y-px"
          >
            <Stop size={14} weight="fill" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            aria-label="Send message"
            title="Send message"
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-ink text-canvas transition-[opacity,transform] active:translate-y-px disabled:opacity-30"
          >
            <ArrowUp size={16} weight="bold" />
          </button>
        )}
      </div>
    </div>
  )
}
