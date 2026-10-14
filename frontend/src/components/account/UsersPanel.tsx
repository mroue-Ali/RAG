import { UserPlus } from '@phosphor-icons/react'
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, errorMessage } from '../../lib/api'
import type { AssignableRole, MemberInfo, NewUser } from '../../lib/types'
import { useAuth } from '../../state/contexts'
import { useAction } from '../../state/useAction'
import { Button } from '../ui/Button'
import { Field, Select, TextInput } from '../ui/Field'
import { RoleBadge } from './RoleBadge'

/** The account's users, for its owner and admins: add, change role, reset a password, remove. */
export function UsersPanel() {
  const [users, setUsers] = useState<MemberInfo[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const reload = useCallback(() => {
    api.users().then(
      (list) => {
        setUsers(list)
        setLoadError(null)
      },
      (failure) => setLoadError(errorMessage(failure)),
    )
  }, [])
  useEffect(reload, [reload])

  if (!users) {
    return loadError ? (
      <p role="alert" className="text-[13px] text-danger">
        The users could not be loaded. {loadError}
      </p>
    ) : (
      <div className="shimmer h-28 rounded-xl" aria-busy="true" aria-label="Loading users" />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="overflow-hidden rounded-xl border border-line">
        {users.map((user) => (
          <UserRow key={user.id} user={user} onChange={reload} />
        ))}
      </ul>
      {adding ? (
        <AddUserForm
          onDone={(added) => {
            setAdding(false)
            if (added) reload()
          }}
        />
      ) : (
        <div>
          <Button onClick={() => setAdding(true)}>
            <UserPlus size={16} />
            Add a user
          </Button>
        </div>
      )}
    </div>
  )
}

type RowMode = 'idle' | 'password' | 'remove'

function UserRow({ user, onChange }: { user: MemberInfo; onChange: () => void }) {
  const { session } = useAuth()
  const me = session.user!
  const [mode, setMode] = useState<RowMode>('idle')
  const [password, setPassword] = useState('')
  const { pending, error, run, clearError } = useAction()

  const isMe = user.id === me.id
  // The owner is only changed by the owner, and nobody changes their own role or removes themselves.
  const editable = !isMe && user.role !== 'owner'

  const switchTo = (next: RowMode) => {
    setMode(next)
    setPassword('')
    clearError()
  }

  const act = async (action: () => Promise<unknown>) => {
    if (await run(action)) {
      switchTo('idle')
      onChange()
    }
  }

  const setRole = (role: AssignableRole) => void act(() => api.updateUser(user.id, { role }))
  const resetPassword = (event: FormEvent) => {
    event.preventDefault()
    void act(() => api.updateUser(user.id, { password }))
  }

  return (
    <li className="border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            <span className="truncate">{user.display_name}</span>
            {isMe && <span className="text-xs font-normal text-ink-faint">You</span>}
          </p>
          <p className="truncate font-mono text-xs text-ink-muted">{user.username}</p>
        </div>

        {editable ? (
          <Select
            aria-label={`Role of ${user.display_name}`}
            value={user.role}
            disabled={pending}
            onChange={(event) => setRole(event.target.value as AssignableRole)}
            className="w-28 text-[13px]"
          >
            <option value="admin">Admin</option>
            <option value="member">Member</option>
          </Select>
        ) : (
          <RoleBadge role={user.role} />
        )}

        {editable && mode === 'idle' && (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => switchTo('password')}>
              Reset password
            </Button>
            <Button variant="ghost" size="sm" onClick={() => switchTo('remove')}>
              Remove
            </Button>
          </div>
        )}
      </div>

      {mode === 'password' && (
        <form onSubmit={resetPassword} className="mt-3 flex flex-wrap gap-2">
          <TextInput
            type="password"
            aria-label={`New password for ${user.display_name}`}
            placeholder="New password, at least 8 characters"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            autoFocus
            className="min-w-0 flex-1 text-[13px]"
          />
          <Button type="submit" variant="primary" disabled={pending || !password}>
            Set password
          </Button>
          <Button onClick={() => switchTo('idle')}>
            Cancel
          </Button>
          <p className="w-full text-xs text-ink-muted">
            Tell them the new one yourself. They are signed out wherever they were signed in.
          </p>
        </form>
      )}

      {mode === 'remove' && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-danger/10 px-3 py-2">
          <p className="flex-1 text-[13px] text-danger">
            Remove {user.display_name}? They lose access to this account at once.
          </p>
          <Button size="sm" onClick={() => switchTo('idle')}>
            Keep
          </Button>
          <Button size="sm" variant="primary" disabled={pending} onClick={() => void act(() => api.removeUser(user.id))}>
            Remove
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {error}
        </p>
      )}
    </li>
  )
}

const EMPTY: NewUser = { username: '', display_name: '', password: '', role: 'member' }

function AddUserForm({ onDone }: { onDone: (added: boolean) => void }) {
  const [user, setUser] = useState<NewUser>(EMPTY)
  const { pending, error, run } = useAction()
  const set = (change: Partial<NewUser>) => setUser((current) => ({ ...current, ...change }))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (await run(() => api.addUser(user))) onDone(true)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4">
      <p className="text-sm font-medium">Add a user</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Username" hint="What they sign in with.">
          {(id) => (
            <TextInput
              id={id}
              value={user.username}
              onChange={(event) => set({ username: event.target.value })}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              required
              autoFocus
            />
          )}
        </Field>
        <Field label="Name" hint="Optional. The username is used otherwise.">
          {(id) => (
            <TextInput
              id={id}
              value={user.display_name}
              maxLength={120}
              onChange={(event) => set({ display_name: event.target.value })}
            />
          )}
        </Field>
        <Field label="Password" hint="At least 8 characters. Give it to them yourself.">
          {(id) => (
            <TextInput
              id={id}
              type="password"
              value={user.password}
              onChange={(event) => set({ password: event.target.value })}
              autoComplete="new-password"
              required
            />
          )}
        </Field>
        <Field label="Role">
          {(id) => (
            <Select id={id} value={user.role} onChange={(event) => set({ role: event.target.value as AssignableRole })}>
              <option value="member">Member: chats with the model</option>
              <option value="admin">Admin: also the model, prompt and users</option>
            </Select>
          )}
        </Field>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Adding' : 'Add user'}
        </Button>
        <Button onClick={() => onDone(false)}>Cancel</Button>
      </div>
    </form>
  )
}
