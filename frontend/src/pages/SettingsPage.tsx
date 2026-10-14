import type { ComponentType } from 'react'
import { Navigate, NavLink, useParams } from 'react-router'
import { PageHeader } from '../components/layout/AppShell'
import { AccountSection } from '../components/settings/AccountSection'
import { AssistantSection } from '../components/settings/AssistantSection'
import { GenerationSection } from '../components/settings/GenerationSection'
import { ModelSection } from '../components/settings/ModelSection'
import { ProfileSection } from '../components/settings/ProfileSection'
import { PromptSection } from '../components/settings/PromptSection'
import { Button } from '../components/ui/Button'
import { cn } from '../lib/cn'
import type { AppSettings, Permission } from '../lib/types'
import { useAuth, useSettings } from '../state/contexts'

// The account's model settings are edited as one draft and saved from the footer.
// The other sections save each change on their own.
type SectionDef = { id: string; label: string; visible: (permissions: Permission[]) => boolean } & (
  | { draft: true; view: ComponentType<{ settings: AppSettings }> }
  | { draft: false; view: ComponentType }
)

const managesModel = (permissions: Permission[]) => permissions.includes('model.manage')

const SECTIONS: SectionDef[] = [
  { id: 'model', label: 'Model', visible: managesModel, draft: true, view: ModelSection },
  { id: 'generation', label: 'Generation', visible: managesModel, draft: true, view: GenerationSection },
  { id: 'prompt', label: 'Prompt', visible: managesModel, draft: true, view: PromptSection },
  { id: 'assistant', label: 'Assistant', visible: managesModel, draft: true, view: AssistantSection },
  { id: 'account', label: 'Account', visible: () => true, draft: false, view: AccountSection },
  { id: 'profile', label: 'Profile', visible: () => true, draft: false, view: ProfileSection },
]

export function SettingsPage() {
  const { session } = useAuth()
  const sections = SECTIONS.filter((candidate) => candidate.visible(session.permissions))
  const { section = sections[0].id } = useParams()

  const current = sections.find((candidate) => candidate.id === section)
  if (!current) return <Navigate to="/settings" replace />

  return (
    <>
      <PageHeader title="Settings" />

      <nav aria-label="Settings sections" className="shrink-0 overflow-x-auto overflow-y-hidden border-b border-line">
        <div className="mx-auto flex w-full max-w-3xl gap-1 px-4 md:px-6">
          {sections.map(({ id, label }) => (
            <NavLink
              key={id}
              to={id === sections[0].id ? '/settings' : `/settings/${id}`}
              end
              className={({ isActive }) =>
                cn(
                  '-mb-px flex h-11 items-center border-b-2 px-2.5 text-sm font-medium whitespace-nowrap transition-colors',
                  isActive ? 'border-ink text-ink' : 'border-transparent text-ink-muted hover:text-ink',
                )
              }
            >
              {label}
            </NavLink>
          ))}
        </div>
      </nav>

      {current.draft ? <DraftSection view={current.view} /> : <StandaloneSection view={current.view} />}
    </>
  )
}

function StandaloneSection({ view: SectionView }: { view: ComponentType }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl divide-y divide-line px-4 py-8 md:px-6">
        <SectionView />
      </div>
    </div>
  )
}

function DraftSection({ view: SectionView }: { view: ComponentType<{ settings: AppSettings }> }) {
  const { draft, dirty, saving, error, save, discard } = useSettings()

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl divide-y divide-line px-4 py-8 md:px-6">
          {draft ? (
            <SectionView settings={draft} />
          ) : error ? (
            <p role="alert" className="text-danger">
              The settings could not be loaded. {error}
            </p>
          ) : (
            <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading settings">
              <div className="shimmer h-5 w-40 rounded-lg" />
              <div className="shimmer h-24 rounded-xl" />
              <div className="shimmer h-5 w-56 rounded-lg" />
              <div className="shimmer h-40 rounded-xl" />
            </div>
          )}
        </div>
      </div>

      <footer className="shrink-0 border-t border-line">
        <div className="mx-auto flex min-h-14 w-full max-w-3xl items-center justify-between gap-4 px-4 py-2 md:px-6">
          <p role="status" className={cn('text-[13px]', error && draft ? 'text-danger' : 'text-ink-muted')}>
            {error && draft
              ? error
              : dirty
                ? 'You have unsaved changes. They apply to everyone in this account.'
                : 'Everything is saved.'}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" onClick={discard} disabled={!dirty || saving}>
              Discard
            </Button>
            <Button variant="primary" onClick={save} disabled={!dirty || saving}>
              {saving ? 'Saving' : 'Save changes'}
            </Button>
          </div>
        </div>
      </footer>
    </>
  )
}
