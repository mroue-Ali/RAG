import { useId } from 'react'
import type { AppSettings, GenerationSettings } from '../../lib/types'
import { useSettings } from '../../state/contexts'
import { NumberInput } from '../ui/Field'
import { Switch } from '../ui/Switch'
import { Row, Section } from './SettingsLayout'

export function GenerationSection({ settings }: { settings: AppSettings }) {
  const { edit } = useSettings()
  const generation = settings.generation
  const set = (change: Partial<GenerationSettings>) =>
    edit((draft) => ({ ...draft, generation: { ...draft.generation, ...change } }))

  return (
    <>
      <Section title="Sampling" description="How the model picks each next token. These apply from the next message on.">
        <Slider
          label="Temperature"
          hint="Lower is more predictable, higher is more varied. At 0 the model always takes its most likely token."
          value={generation.temperature}
          min={0}
          max={2}
          step={0.05}
          onChange={(temperature) => set({ temperature })}
        />
        <Slider
          label="Top P"
          hint="Only sample from the most likely tokens that together reach this probability. 1 considers all of them."
          value={generation.top_p}
          min={0.05}
          max={1}
          step={0.05}
          onChange={(top_p) => set({ top_p })}
        />
      </Section>

      <Section title="Length and memory">
        <Row label="Response length" hint="The most tokens a single reply may use before it is cut off.">
          <NumberInput
            aria-label="Response length in tokens"
            value={generation.max_tokens}
            min={1}
            max={32768}
            onChange={(max_tokens) => set({ max_tokens })}
            className="w-28"
          />
        </Row>
        <Row
          label="History"
          hint="How many earlier messages are sent along with each new one. 0 sends the whole conversation."
        >
          <NumberInput
            aria-label="History in messages"
            value={generation.history_messages}
            min={0}
            max={500}
            onChange={(history_messages) => set({ history_messages })}
            className="w-28"
          />
        </Row>
        <Row label="Stream replies" hint="Show the reply as it is written instead of all at once at the end.">
          <Switch label="Stream replies" checked={generation.stream} onChange={(stream) => set({ stream })} />
        </Row>
      </Section>
    </>
  )
}

interface SliderProps {
  label: string
  hint: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}

function Slider({ label, hint, value, min, max, step, onChange }: SliderProps) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-[13px] font-medium">
          {label}
        </label>
        <output htmlFor={id} className="font-mono text-[13px] tabular-nums">
          {value.toFixed(2)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.valueAsNumber)}
        className="h-5 w-full accent-accent"
      />
      <p className="max-w-[65ch] text-[13px] text-ink-muted">{hint}</p>
    </div>
  )
}
