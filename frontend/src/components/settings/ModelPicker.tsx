import { ArrowsClockwise, Check } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api, errorMessage } from '../../lib/api'
import { cn } from '../../lib/cn'
import { formatBytes, formatContext } from '../../lib/format'
import type { ModelInfo, ModelsRequest, ModelsResponse } from '../../lib/types'
import { useModel } from '../../state/contexts'
import { Button } from '../ui/Button'
import { Field, TextInput } from '../ui/Field'

interface ModelPickerProps {
  value: string
  onChange: (model: string) => void
  /** Where to list models from. null holds off, with `idleText` explaining what is missing. */
  query: ModelsRequest | null
  idleText?: string
  emptyText: string
  /** Without these the model can only be picked from the list, not typed. */
  placeholder?: string
  hint?: ReactNode
}

/** The provider's own list to pick from, with a field above to type an id when `placeholder` is given. */
export function ModelPicker({ value, onChange, query, idleText, emptyText, placeholder, hint }: ModelPickerProps) {
  const { loading, models, note, error, refresh } = useModelList(query)

  const typed = placeholder !== undefined
  // Typing narrows the list. Once the text is a listed id, show everything again.
  const needle = typed ? value.trim().toLowerCase() : ''
  const matches = models.filter((model) => `${model.id} ${model.name ?? ''}`.toLowerCase().includes(needle))
  const narrowed = needle !== '' && matches.length > 0 && !models.some((model) => model.id === value)
  const shown = narrowed ? matches : models

  return (
    <div className="flex flex-col gap-3">
      {typed ? (
        <Field label="Model" hint={hint}>
          {(id) => (
            <TextInput
              id={id}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder={placeholder}
              spellCheck={false}
              autoComplete="off"
              className="font-mono text-[13px]"
            />
          )}
        </Field>
      ) : (
        <p className="text-[13px] font-medium">Model</p>
      )}

      <div className="overflow-hidden rounded-xl border border-line">
        <div className="flex h-10 items-center justify-between gap-3 border-b border-line bg-sunken/60 pr-1 pl-4">
          <p className="truncate text-xs text-ink-muted">
            <span className="font-medium text-ink">Available</span>
            {note && <span className="ml-2 font-mono">{note}</span>}
          </p>
          <Button variant="ghost" size="sm" onClick={refresh} disabled={!query || loading}>
            <ArrowsClockwise size={14} className={cn(loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>

        {!query ? (
          <Notice>{idleText}</Notice>
        ) : loading ? (
          <div className="flex flex-col gap-2 p-3" aria-busy="true" aria-label="Loading models">
            <div className="shimmer h-9 rounded-lg" />
            <div className="shimmer h-9 rounded-lg" />
            <div className="shimmer h-9 w-2/3 rounded-lg" />
          </div>
        ) : error ? (
          <Notice tone="danger">{error}</Notice>
        ) : models.length === 0 ? (
          <Notice>{emptyText}</Notice>
        ) : (
          <>
            {!typed && value && !loading && !models.some((model) => model.id === value) && (
              <Notice tone="warn">The selected model, {value}, is not in this list. Pick one below.</Notice>
            )}
            <ul aria-label="Available models" className="max-h-72 overflow-y-auto p-1">
              {shown.map((model) => (
                <ModelRow
                  key={model.id}
                  model={model}
                  selected={model.id === value}
                  onSelect={() => onChange(model.id)}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

function ModelRow({ model, selected, onSelect }: { model: ModelInfo; selected: boolean; onSelect: () => void }) {
  const facts = [
    model.params,
    model.quantization,
    model.architecture && !model.params ? model.architecture : null,
    model.size_bytes ? formatBytes(model.size_bytes) : null,
    model.context_length ? formatContext(model.context_length) : null,
  ].filter(Boolean)

  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
          selected ? 'bg-sunken' : 'hover:bg-sunken/60',
        )}
      >
        <Check size={14} weight="bold" className={cn('shrink-0 text-accent', !selected && 'invisible')} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{model.name ?? model.id}</span>
          {model.name && <span className="block truncate font-mono text-xs text-ink-faint">{model.id}</span>}
        </span>
        <span className="hidden shrink-0 gap-3 font-mono text-xs text-ink-muted sm:flex">
          {facts.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
        </span>
        {model.loaded && (
          <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
            In memory
          </span>
        )}
      </button>
    </li>
  )
}

const TONES = {
  danger: 'text-danger',
  warn: 'border-b border-line text-warn',
  muted: 'text-ink-muted',
}

function Notice({ tone = 'muted', children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <p className={cn('px-4 py-3.5 text-[13px] break-all', TONES[tone])}>{children}</p>
}

function useModelList(query: ModelsRequest | null) {
  const { state } = useModel()
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{
    key: string
    response?: ModelsResponse
    error?: string
  } | null>(null)

  // Loading or unloading changes which models are in memory, so the runtime is part of the key.
  const key = query ? JSON.stringify([query, attempt, state?.status, state?.model]) : null
  useEffect(() => {
    if (!key) return
    let current = true
    const [request] = JSON.parse(key) as [ModelsRequest]
    api.listModels(request).then(
      (response) => current && setResult({ key, response }),
      (failure) => current && setResult({ key, error: errorMessage(failure) }),
    )
    return () => {
      current = false
    }
  }, [key])

  // A result for an older key is stale: treat it as still loading.
  const settled = result && result.key === key ? result : null
  return {
    loading: key !== null && settled === null,
    models: settled?.response?.models ?? [],
    note: settled?.response?.note ?? null,
    error: settled?.error ?? null,
    refresh: () => setAttempt((count) => count + 1),
  }
}
