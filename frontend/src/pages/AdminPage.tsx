import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router'
import { RoleBadge, SuperadminBadge } from '../components/account/RoleBadge'
import { PageHeader } from '../components/layout/AppShell'
import { Row, Section } from '../components/settings/SettingsLayout'
import { Button } from '../components/ui/Button'
import { Switch } from '../components/ui/Switch'
import { api, errorMessage } from '../lib/api'
import { formatDate } from '../lib/format'
import { PROVIDERS } from '../lib/providers'
import type { AdminAccount, DatabaseStatus, MemberInfo } from '../lib/types'
import { useAuth } from '../state/contexts'
import { useAction } from '../state/useAction'

const SIGNUP: Record<'open' | 'closed' | 'setup', string> = {
  open: 'Open. Anyone who reaches the sign-in page can create an account.',
  closed: 'Closed. People get in when an admin of an account adds them.',
  setup: 'Not set up yet.',
}

/** The whole instance, for the people who run it: how it is configured, and every account on it. */
export function AdminPage() {
  const { session } = useAuth()
  if (!session.user?.is_superadmin) return <Navigate to="/" replace />

  return (
    <>
      <PageHeader title="Admin" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl divide-y divide-line px-4 py-8 md:px-6">
          <InstanceSection />
          <AccountsSection />
        </div>
      </div>
    </>
  )
}

function InstanceSection() {
  const { session } = useAuth()
  const [database, setDatabase] = useState<DatabaseStatus | null>(null)
  useEffect(() => {
    api.database().then(setDatabase, () => {})
  }, [])

  return (
    <Section title="Instance" description="Set in backend/.env when the server starts. Restart it after a change.">
      <Row label="Sign-up" hint={SIGNUP[session.signup]}>
        <code className="font-mono text-xs text-ink-muted">OPEN_SIGNUP</code>
      </Row>
      <Row
        label="Providers"
        hint={session.providers
          .map(({ kind, available }) => `${PROVIDERS[kind].label}: ${available ? 'on' : 'off'}`)
          .join(' · ')}
      >
        <code className="font-mono text-xs text-ink-muted">LOCAL_MODELS</code>
      </Row>
      {database && (
        <>
          <Row label="Database" hint={<span className="font-mono text-xs break-all">{database.location}</span>}>
            <span className="text-[13px]">{database.backend === 'sqlite' ? 'SQLite' : 'PostgreSQL'}</span>
          </Row>
          {database.fallback && (
            <p className="rounded-lg bg-warn/10 px-3 py-2.5 text-[13px] text-warn">
              The configured database could not be reached, so a local SQLite file is used instead. Everything saved
              now stays in that file and is not copied over when the database comes back.
              <span className="mt-1 block font-mono text-xs break-all">{database.error}</span>
            </p>
          )}
        </>
      )}
    </Section>
  )
}

function AccountsSection() {
  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    api.allAccounts().then(
      (list) => {
        setAccounts(list)
        setError(null)
      },
      (failure) => setError(errorMessage(failure)),
    )
  }, [])
  useEffect(reload, [reload])

  const people = accounts?.reduce((total, account) => total + account.users.length, 0) ?? 0
  const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

  return (
    <Section
      title="Accounts"
      description={
        accounts ? `${count(accounts.length, 'account')}, ${count(people, 'user')}.` : 'Every account on this instance.'
      }
    >
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      {!accounts && !error && <div className="shimmer h-40 rounded-xl" aria-busy="true" aria-label="Loading accounts" />}
      {accounts?.map((account) => <AccountCard key={account.id} account={account} onChange={reload} />)}
    </Section>
  )
}

function AccountCard({ account, onChange }: { account: AdminAccount; onChange: () => void }) {
  const { session } = useAuth()
  const own = account.id === session.account?.id
  const [confirming, setConfirming] = useState(false)
  const { pending, error, run } = useAction()

  const remove = async () => {
    if (await run(() => api.deleteAccount(account.id))) onChange()
  }

  return (
    <article className="overflow-hidden rounded-xl border border-line">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">
            {account.name}
            {own && <span className="ml-2 text-xs font-normal text-ink-faint">Yours</span>}
          </h3>
          <p className="text-xs text-ink-muted">Created {formatDate(account.created_at)}</p>
        </div>
        {!own && !confirming && (
          <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
            Delete account
          </Button>
        )}
      </header>

      {confirming && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-danger/10 px-4 py-3">
          <p className="flex-1 text-[13px] text-danger">
            Delete {account.name}, its {account.users.length} users and all its data? This cannot be undone.
          </p>
          <Button size="sm" onClick={() => setConfirming(false)}>
            Keep
          </Button>
          <Button size="sm" variant="primary" disabled={pending} onClick={remove}>
            Delete for good
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="border-b border-line px-4 py-2 text-[13px] text-danger">
          {error}
        </p>
      )}

      <ul>
        {account.users.map((user) => (
          <AdminUserRow key={user.id} user={user} onChange={onChange} />
        ))}
      </ul>
    </article>
  )
}

function AdminUserRow({ user, onChange }: { user: MemberInfo; onChange: () => void }) {
  const { session } = useAuth()
  const isMe = user.id === session.user?.id
  const { pending, error, run } = useAction()

  const toggle = async (value: boolean) => {
    if (await run(() => api.setSuperadmin(user.id, value))) onChange()
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[13px] font-medium">
          <span className="truncate">{user.display_name}</span>
          {isMe && <span className="text-xs font-normal text-ink-faint">You</span>}
        </p>
        <p className="truncate font-mono text-xs text-ink-muted">{user.username}</p>
      </div>
      <span className="flex gap-1.5">
        <RoleBadge role={user.role} />
        {user.is_superadmin && <SuperadminBadge />}
      </span>
      {/* Giving it up yourself is refused, so the instance never ends up with nobody running it. */}
      {!isMe && (
        <span className={pending ? 'pointer-events-none opacity-50' : undefined}>
          <Switch label={`Superadmin: ${user.display_name}`} checked={user.is_superadmin} onChange={toggle} />
        </span>
      )}
      {error && <p className="w-full text-xs text-danger">{error}</p>}
    </li>
  )
}
