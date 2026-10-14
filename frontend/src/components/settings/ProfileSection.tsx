import { useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../../lib/api'
import { setTheme, useThemeChoice } from '../../lib/theme'
import { useAuth } from '../../state/contexts'
import { useAction } from '../../state/useAction'
import { RoleBadge, SuperadminBadge } from '../account/RoleBadge'
import { Button } from '../ui/Button'
import { Field, TextInput } from '../ui/Field'
import { Segmented } from '../ui/Segmented'
import { Row, Section } from './SettingsLayout'

/** Yours alone: your name, your password, how the app looks in this browser. */
export function ProfileSection() {
  const { session, signOut } = useAuth()
  const user = session.user!
  const theme = useThemeChoice()

  return (
    <>
      <Section title="Profile" description="How you appear to the others in this account.">
        <NameForm />
        <Row label="Username" hint="What you sign in with. It cannot be changed.">
          <span className="font-mono text-[13px]">{user.username}</span>
        </Row>
      </Section>

      <Section title="Password">
        <PasswordForm />
      </Section>

      <Section title="Appearance">
        <Row label="Theme" hint="Saved in this browser, and applied right away.">
          <Segmented
            label="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </Row>
      </Section>

      <Section title="Session">
        <Row
          label={`Signed in to ${session.account?.name}`}
          hint={
            <span className="mt-1 flex flex-wrap gap-1.5">
              <RoleBadge role={user.role} />
              {user.is_superadmin && <SuperadminBadge />}
            </span>
          }
        >
          <Button onClick={signOut}>Sign out</Button>
        </Row>
      </Section>
    </>
  )
}

function NameForm() {
  const { session, update } = useAuth()
  const saved = session.user!.display_name
  const [name, setName] = useState(saved)
  const { pending, error, run } = useAction()
  const changed = name.trim() !== '' && name.trim() !== saved

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => update(await api.updateProfile(name.trim())))
  }

  return (
    <form onSubmit={submit}>
      <Field label="Name" hint="The prompt can use it too, as {{user_name}}." error={error}>
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

function PasswordForm() {
  const { session, update } = useAuth()
  const hasPassword = session.user!.has_password
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [done, setDone] = useState(false)
  const { pending, error, run } = useAction()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setDone(false)
    if (await run(async () => update(await api.changePassword(current, next)))) {
      setCurrent('')
      setNext('')
      setDone(true)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {!hasPassword && (
        <p className="text-[13px] text-ink-muted">
          You sign in with Google. Set a password to also sign in with your username.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {hasPassword && (
          <Field label="Current password">
            {(id) => (
              <TextInput
                id={id}
                type="password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                autoComplete="current-password"
                required
              />
            )}
          </Field>
        )}
        <Field label="New password" hint="At least 8 characters.">
          {(id) => (
            <TextInput
              id={id}
              type="password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              autoComplete="new-password"
              required
            />
          )}
        </Field>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="text-[13px] text-accent">
          Password changed. Any other browser signed in as you has been signed out.
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending || !next}>
          {pending ? 'Saving' : hasPassword ? 'Change password' : 'Set password'}
        </Button>
      </div>
    </form>
  )
}
