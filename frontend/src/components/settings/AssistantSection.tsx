import type { AppSettings, GeneralSettings } from '../../lib/types'
import { useSettings } from '../../state/contexts'
import { Field, TextInput } from '../ui/Field'
import { Section } from './SettingsLayout'

export function AssistantSection({ settings }: { settings: AppSettings }) {
  const { edit } = useSettings()
  const general = settings.general
  const set = (change: Partial<GeneralSettings>) => edit((draft) => ({ ...draft, general: { ...draft.general, ...change } }))

  return (
    <Section
      title="Assistant"
      description="Shown in the chat for everyone in this account, and available to the prompt as {{assistant_name}}."
    >
      <Field label="Name" className="sm:max-w-xs">
        {(id) => (
          <TextInput
            id={id}
            value={general.assistant_name}
            maxLength={60}
            onChange={(event) => set({ assistant_name: event.target.value })}
            placeholder="Assistant"
          />
        )}
      </Field>
    </Section>
  )
}
