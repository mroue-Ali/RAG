import { ArrowCounterClockwise } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import type { AppSettings, GeneralSettings, PromptPreview, PromptSettings, PromptVariable } from '../../lib/types'
import { useSettings } from '../../state/contexts'
import { Button } from '../ui/Button'
import { Field, TextArea, TextInput } from '../ui/Field'
import { Section } from './SettingsLayout'

type TemplateName = keyof PromptSettings

export function PromptSection({ settings }: { settings: AppSettings }) {
  const { edit } = useSettings()
  const prompt = settings.prompt
  const set = (change: Partial<PromptSettings>) => edit((draft) => ({ ...draft, prompt: { ...draft.prompt, ...change } }))

  const variables = useVariables()
  const [question, setQuestion] = useState('What should I read next?')
  const { preview, stale } = usePreview(prompt, settings.general, question)

  const fields = useRef<Record<TemplateName, HTMLTextAreaElement | null>>({ system_template: null, user_template: null })
  // Variables are inserted into whichever template was edited last.
  const target = useRef<TemplateName>('system_template')

  const insert = (variable: PromptVariable) => {
    const name: TemplateName = variable.scope === 'user' ? 'user_template' : target.current
    const field = fields.current[name]
    if (!field) return
    const token = `{{${variable.name}}}`
    const start = field.selectionStart
    set({ [name]: prompt[name].slice(0, start) + token + prompt[name].slice(field.selectionEnd) })
    caret.current = { field, position: start + token.length }
  }

  // Writing a new value moves the caret to the end. Once React has written it,
  // put the caret back right after the inserted placeholder.
  const caret = useRef<{ field: HTMLTextAreaElement; position: number } | null>(null)
  useLayoutEffect(() => {
    if (!caret.current) return
    const { field, position } = caret.current
    caret.current = null
    field.focus()
    field.setSelectionRange(position, position)
  })

  const reset = async () => {
    const defaults = await api.defaultSettings()
    set(defaults.prompt)
  }

  return (
    <>
      <Section
        title="Templates"
        description="The text that frames every conversation. Placeholders in double braces are filled in when a message is sent."
      >
        <Field label="System prompt" hint="Sent once at the start of each request. Leave empty to send none.">
          {(id) => (
            <TextArea
              id={id}
              ref={(element) => void (fields.current.system_template = element)}
              rows={9}
              value={prompt.system_template}
              onChange={(event) => set({ system_template: event.target.value })}
              onFocus={() => (target.current = 'system_template')}
              spellCheck={false}
              className="font-mono text-[13px]"
            />
          )}
        </Field>

        <Field
          label="Message template"
          hint="Wraps the message you type before it reaches the model."
          error={
            prompt.user_template.includes('question')
              ? undefined
              : 'Without {{question}} here, the model never sees what you typed.'
          }
        >
          {(id) => (
            <TextArea
              id={id}
              ref={(element) => void (fields.current.user_template = element)}
              rows={3}
              value={prompt.user_template}
              onChange={(event) => set({ user_template: event.target.value })}
              onFocus={() => (target.current = 'user_template')}
              spellCheck={false}
              className="font-mono text-[13px]"
            />
          )}
        </Field>

        <div>
          <p className="text-[13px] font-medium">Placeholders</p>
          <p className="mt-0.5 text-[13px] text-ink-muted">Select one to insert it where the cursor is.</p>
          <ul className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {variables.map((variable) => (
              <li key={variable.name} className="flex items-baseline gap-3">
                <button
                  type="button"
                  // Keep focus, and with it the cursor position, in the template being edited.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insert(variable)}
                  className="shrink-0 rounded-lg bg-sunken px-2 py-1 font-mono text-xs transition-colors hover:bg-line"
                >
                  {`{{${variable.name}}}`}
                </button>
                <span className="text-[13px] text-ink-muted">
                  {variable.description}
                  {variable.scope === 'user' && '. Message template only'}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <Button size="sm" onClick={reset}>
            <ArrowCounterClockwise size={14} />
            Restore the default templates
          </Button>
        </div>
      </Section>

      <Section title="Preview" description="Exactly what the model would receive for the message below, with the current edits.">
        <Field label="Sample message">
          {(id) => <TextInput id={id} value={question} onChange={(event) => setQuestion(event.target.value)} />}
        </Field>
        <div className={stale ? 'opacity-60 transition-opacity' : 'transition-opacity'} aria-busy={stale}>
          {preview ? (
            <div className="overflow-hidden rounded-xl border border-line">
              <PreviewBlock role="system" text={preview.system} emptyText="No system message is sent." />
              <PreviewBlock role="user" text={preview.user} emptyText="Empty: the message is sent as typed." />
            </div>
          ) : (
            <div className="shimmer h-32 rounded-xl" />
          )}
          {preview && preview.unknown.length > 0 && (
            <p className="mt-2 text-[13px] text-warn">
              Not a known placeholder, so it is sent as written: {preview.unknown.map((name) => `{{${name}}}`).join(', ')}
            </p>
          )}
        </div>
      </Section>
    </>
  )
}

function PreviewBlock({ role, text, emptyText }: { role: string; text: string; emptyText: string }) {
  return (
    <div className="border-b border-line px-4 py-3 last:border-b-0">
      <p className="font-mono text-xs text-ink-faint">{role}</p>
      {text ? (
        <p className="mt-1 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap">{text}</p>
      ) : (
        <p className="mt-1 text-[13px] text-ink-muted">{emptyText}</p>
      )}
    </div>
  )
}

function useVariables(): PromptVariable[] {
  const [variables, setVariables] = useState<PromptVariable[]>([])
  useEffect(() => {
    let current = true
    api.promptVariables().then(
      (list) => current && setVariables(list),
      () => {},
    )
    return () => {
      current = false
    }
  }, [])
  return variables
}

/** The templates rendered by the server, so the preview cannot drift from what chat really sends. */
function usePreview(prompt: PromptSettings, general: GeneralSettings, question: string) {
  const key = JSON.stringify([prompt, general, question])
  const [result, setResult] = useState<{ key: string; preview: PromptPreview } | null>(null)

  useEffect(() => {
    let current = true
    const timer = window.setTimeout(() => {
      const [nextPrompt, nextGeneral, nextQuestion] = JSON.parse(key) as [PromptSettings, GeneralSettings, string]
      api.previewPrompt(nextPrompt, nextGeneral, nextQuestion).then(
        (preview) => current && setResult({ key, preview }),
        () => {},
      )
    }, 250)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [key])

  return { preview: result?.preview ?? null, stale: result !== null && result.key !== key }
}
