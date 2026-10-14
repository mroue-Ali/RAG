import { useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../../lib/api'
import { ROLES } from '../../lib/roles'
import type { Role } from '../../lib/types'
import { useAuth, useCan } from '../../state/contexts'
import { useAction } from '../../state/useAction'
import { RoleBadge } from '../account/RoleBadge'
import { UsersPanel } from '../account/UsersPanel'
import { Button } from '../ui/Button'
import { Field, TextInput } from '../ui/Field'
import { Row, Section } from './SettingsLayout'

const ROLE_ORDER: Role[] = ['owner', 'admin', 'member']

/** The account everyone here shares, and the people in it. */
export function AccountSection() {
  const { session } = useAuth()
  const rename = useCan('account.manage')
  const manageUsers = useCan('users.manage')

  return (
    <>
      <Section
        title="Account"
        description="The account holds the model, the prompt and the settings, and later the documents. Everyone in it shares them."
      >
        {rename ? (
          <NameForm />
        ) : (
          <Row label="Name">
            <span className="text-[13px]">{session.account?.name}</span>
          </Row>
        )}
      </Section>

      {manageUsers && (
        <Section title="Users" description="Everyone here signs in with their own username and password.">
          <UsersPanel />
        </Section>
      )}

      <Section title="Roles">
        <dl className="flex flex-col gap-3">
          {ROLE_ORDER.map((role) => (
            <div key={role} className="flex items-baseline gap-3">
              <dt className="w-20 shrink-0">
                <RoleBadge role={role} />
              </dt>
              <dd className="text-[13px] text-ink-muted">{ROLES[role].description}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </>
  )
}

function NameForm() {
  const { session, update } = useAuth()
  const saved = session.account?.name ?? ''
  const [name, setName] = useState(saved)
  const { pending, error, run } = useAction()
  const changed = name.trim() !== '' && name.trim() !== saved

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => update(await api.renameAccount(name.trim())))
  }

  return (
    <form onSubmit={submit}>
      <Field label="Name" error={error}>
        {(id) => (
          <div className="flex gap-2">
            <TextInput
              id={id}
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              className="min-w-0 flex-1"
            />
            <Button type="submit" disabled={!changed || pending}>
              {pending ? 'Saving' : 'Save'}
            </Button>
          </div>
        )}
      </Field>
    </form>
  )
}
