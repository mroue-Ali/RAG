import { Cloud, Cpu, Desktop, Lock } from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import { useState } from 'react'
import { cn } from '../../lib/cn'
import { isLocal, PROVIDERS } from '../../lib/providers'
import type { AppSettings, LLMSettings, ModelsRequest, OpenAIConfig, ProviderInfo, ProviderKind } from '../../lib/types'
import { useAuth, useSettings } from '../../state/contexts'
import { Button } from '../ui/Button'
import { Field, NumberInput, Select, TextInput } from '../ui/Field'
import { Segmented } from '../ui/Segmented'
import { Switch } from '../ui/Switch'
import { ConnectionPanel } from './ConnectionPanel'
import { FolderPicker } from './FolderPicker'
import { ModelPicker } from './ModelPicker'
import { RuntimePanel } from './RuntimePanel'
import { Row, Section } from './SettingsLayout'

const ICONS: Record<ProviderKind, Icon> = { transformers: Cpu, lmstudio: Desktop, openai: Cloud }

export function ModelSection({ settings }: { settings: AppSettings }) {
  const { edit } = useSettings()
  const { session } = useAuth()
  const llm = settings.llm
  const setLlm = (change: Partial<LLMSettings>) => edit((draft) => ({ ...draft, llm: { ...draft.llm, ...change } }))

  return (
    <>
      <Section
        title="Provider"
        description="Where the model runs, for everyone in this account. Each provider keeps its own configuration, so switching does not lose anything."
      >
        <ProviderPicker providers={session.providers} value={llm.provider} onChange={(provider) => setLlm({ provider })} />
      </Section>

      <Section title={PROVIDERS[llm.provider].label}>
        {llm.provider === 'transformers' && <TransformersForm llm={llm} setLlm={setLlm} />}
        {llm.provider === 'lmstudio' && <LMStudioForm llm={llm} setLlm={setLlm} />}
        {llm.provider === 'openai' && <OpenAIForm llm={llm} setLlm={setLlm} />}
      </Section>

      {!isLocal(llm.provider) ? (
        <Section title="Connection">
          <ConnectionPanel />
        </Section>
      ) : (
        <Section title="Runtime" description="Settings are only read when a model is loaded. Load again after changing them.">
          <RuntimePanel />
          <Row label="Load on startup" hint="Load this model as soon as the backend starts, instead of waiting for you.">
            <Switch label="Load on startup" checked={llm.auto_load} onChange={(auto_load) => setLlm({ auto_load })} />
          </Row>
        </Section>
      )}
    </>
  )
}

interface ProviderPickerProps {
  providers: ProviderInfo[]
  value: ProviderKind
  onChange: (provider: ProviderKind) => void
}

/** Every provider, always. One this server cannot run stays visible but disabled, saying why. */
function ProviderPicker({ providers, value, onChange }: ProviderPickerProps) {
  return (
    <div role="radiogroup" aria-label="Provider" className="overflow-hidden rounded-xl border border-line">
      {providers.map(({ kind, available, reason }) => {
        const selected = kind === value
        const ProviderIcon = ICONS[kind]
        return (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={!available}
            onClick={() => onChange(kind)}
            className={cn(
              'flex w-full items-start gap-3.5 border-b border-line px-4 py-3.5 text-left transition-colors last:border-b-0',
              selected ? 'bg-surface' : available ? 'hover:bg-sunken/60' : 'cursor-not-allowed bg-sunken/40',
            )}
          >
            <span
              className={cn(
                'mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border',
                selected ? 'border-accent' : 'border-line-strong',
              )}
            >
              {selected && <span className="size-2 rounded-full bg-accent" />}
            </span>
            <span className={cn('min-w-0 flex-1', !available && 'opacity-60')}>
              <span className="block text-sm font-medium">{PROVIDERS[kind].label}</span>
              <span className="mt-0.5 block text-[13px] text-ink-muted">{PROVIDERS[kind].description}</span>
              {reason && (
                <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-line-strong px-2 py-0.5 text-xs text-ink-muted">
                  <Lock size={12} />
                  {reason}
                </span>
              )}
            </span>
            <ProviderIcon size={18} className={cn('mt-0.5 shrink-0', selected ? 'text-ink' : 'text-ink-faint')} />
          </button>
        )
      })}
    </div>
  )
}

interface FormProps {
  llm: LLMSettings
  setLlm: (change: Partial<LLMSettings>) => void
}

function TransformersForm({ llm, setLlm }: FormProps) {
  const config = llm.transformers
  const set = (change: Partial<typeof config>) => setLlm({ transformers: { ...config, ...change } })

  return (
    <>
      <FolderPicker value={config.models_dir} onChange={(models_dir) => set({ models_dir })} />
      <ModelPicker
        value={config.model}
        onChange={(model) => set({ model })}
        query={{ provider: 'transformers', models_dir: config.models_dir }}
        emptyText={
          config.models_dir
            ? 'No chat models in this folder. A model folder holds a config.json and its weights.'
            : 'No chat models in the Hugging Face cache yet. Browse to the folder where your models are.'
        }
      />
      <Row label="Device" hint="Auto uses the GPU when torch can see one.">
        <Segmented
          label="Device"
          value={config.device}
          onChange={(device) => set({ device })}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'cuda', label: 'GPU' },
            { value: 'cpu', label: 'CPU' },
          ]}
        />
      </Row>
      <Row label="Precision" hint="Auto keeps half precision on the GPU and uses float32 on the CPU.">
        <Select
          aria-label="Precision"
          value={config.dtype}
          onChange={(event) => set({ dtype: event.target.value as typeof config.dtype })}
          className="w-36"
        >
          <option value="auto">Auto</option>
          <option value="float16">float16</option>
          <option value="bfloat16">bfloat16</option>
          <option value="float32">float32</option>
        </Select>
      </Row>
      <Row
        label="Quantization"
        hint="Shrinks the model in GPU memory at some cost in quality. Needs a CUDA GPU and bitsandbytes."
      >
        <Segmented
          label="Quantization"
          value={config.quantization}
          onChange={(quantization) => set({ quantization })}
          options={[
            { value: 'none', label: 'Off' },
            { value: '8bit', label: '8-bit' },
            { value: '4bit', label: '4-bit' },
          ]}
        />
      </Row>
    </>
  )
}

function LMStudioForm({ llm, setLlm }: FormProps) {
  const config = llm.lmstudio
  const set = (change: Partial<typeof config>) => setLlm({ lmstudio: { ...config, ...change } })
  // The list is fetched from the address as it was when the field was last left, not on every keystroke.
  const [listedUrl, setListedUrl] = useState(config.base_url)

  return (
    <>
      <Field label="Server address" hint="Start the server from the Developer tab in LM Studio.">
        {(id) => (
          <TextInput
            id={id}
            value={config.base_url}
            onChange={(event) => set({ base_url: event.target.value })}
            onBlur={() => setListedUrl(config.base_url)}
            placeholder="http://localhost:1234/v1"
            spellCheck={false}
            className="font-mono text-[13px]"
          />
        )}
      </Field>
      <ModelPicker
        value={config.model}
        onChange={(model) => set({ model })}
        query={{ provider: 'lmstudio', base_url: listedUrl }}
        placeholder="Pick a model below"
        hint="Loading it here loads it in LM Studio too."
        emptyText="LM Studio has no chat models downloaded."
      />
      <TimeoutField llm={llm} setLlm={setLlm} />
    </>
  )
}

function OpenAIForm({ llm, setLlm }: FormProps) {
  const config = llm.openai
  const set = (change: Partial<OpenAIConfig>) => setLlm({ openai: { ...config, ...change } })
  const [listed, setListed] = useState({ base_url: config.base_url, api_key: config.api_key })
  const relist = () => setListed({ base_url: config.base_url, api_key: config.api_key })

  // Without a key the official API only answers 401, so wait for one. Other servers may not need it.
  const hasKey = listed.api_key ? true : listed.api_key === null && config.api_key_set
  const needsKey = listed.base_url.includes('api.openai.com')
  const query: ModelsRequest | null =
    hasKey || !needsKey ? { provider: 'openai', base_url: listed.base_url, api_key: listed.api_key } : null

  return (
    <>
      <Field label="Base URL" hint="The address that ends in /v1 for most providers.">
        {(id) => (
          <TextInput
            id={id}
            value={config.base_url}
            onChange={(event) => set({ base_url: event.target.value })}
            onBlur={relist}
            placeholder="https://api.openai.com/v1"
            spellCheck={false}
            className="font-mono text-[13px]"
          />
        )}
      </Field>
      <ApiKeyField config={config} onChange={(api_key) => set({ api_key })} onCommit={relist} />
      <ModelPicker
        value={config.model}
        onChange={(model) => set({ model })}
        query={query}
        idleText="Add an API key to list the models this account can use."
        placeholder="gpt-4o-mini"
        hint="The exact id the provider expects."
        emptyText="This server does not list its models. Type the model id above."
      />
      <TimeoutField llm={llm} setLlm={setLlm} />
    </>
  )
}

interface ApiKeyFieldProps {
  config: OpenAIConfig
  /** null keeps the stored key, '' removes it, anything else replaces it. */
  onChange: (key: string | null) => void
  onCommit: () => void
}

function ApiKeyField({ config, onChange, onCommit }: ApiKeyFieldProps) {
  const { saved } = useSettings()
  // Tied to this version of the saved settings, so a save puts the field back to "stored".
  const [replacingIn, setReplacingIn] = useState<AppSettings | null>(null)
  const replacing = replacingIn !== null && replacingIn === saved
  const removing = config.api_key_set && config.api_key === ''
  const hint = 'Stored on the server. It is never sent back to the browser.'

  if (removing) {
    return (
      <Field label="API key" hint="The stored key is removed when you save.">
        {(id) => (
          <div id={id} className="flex h-9 items-center justify-between rounded-lg border border-line pr-1 pl-3">
            <span className="text-[13px] text-ink-muted">No key</span>
            <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
              Undo
            </Button>
          </div>
        )}
      </Field>
    )
  }

  if (config.api_key_set && !replacing) {
    return (
      <Field label="API key" hint={hint}>
        {(id) => (
          <div id={id} className="flex h-9 items-center justify-between rounded-lg border border-line pr-1 pl-3">
            <span className="text-[13px] text-ink-muted">A key is stored</span>
            <span className="flex">
              <Button variant="ghost" size="sm" onClick={() => setReplacingIn(saved)}>
                Replace
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onChange('')}>
                Remove
              </Button>
            </span>
          </div>
        )}
      </Field>
    )
  }

  return (
    <Field label="API key" hint={hint}>
      {(id) => (
        <div className="flex gap-2">
          <TextInput
            id={id}
            type="password"
            value={config.api_key ?? ''}
            onChange={(event) => onChange(event.target.value || null)}
            onBlur={onCommit}
            placeholder={replacing ? 'New key' : 'Leave empty for servers that need none'}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 font-mono text-[13px]"
          />
          {replacing && (
            <Button
              onClick={() => {
                onChange(null)
                setReplacingIn(null)
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      )}
    </Field>
  )
}

function TimeoutField({ llm, setLlm }: FormProps) {
  return (
    <Row label="Request timeout" hint="Seconds to wait for the server before giving up on a reply.">
      <NumberInput
        aria-label="Request timeout in seconds"
        value={llm.request_timeout}
        min={5}
        max={3600}
        onChange={(request_timeout) => setLlm({ request_timeout })}
        className="w-28"
      />
    </Row>
  )
}
