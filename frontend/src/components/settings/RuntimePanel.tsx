import { configuredModel, PROVIDERS, statusLabel } from '../../lib/providers'
import { useModel, useSettings } from '../../state/contexts'
import { Button } from '../ui/Button'
import { StatusDot } from '../ui/StatusDot'

/** For a local provider: what is in memory right now, and the buttons that change it. */
export function RuntimePanel() {
  const { state, error, load, unload } = useModel()
  const { saved, draft, dirty, saving, save } = useSettings()

  const status = state?.status ?? 'unloaded'
  const active = status !== 'unloaded' ? state : null
  const target = draft ? configuredModel(draft) : ''
  const problem = error ?? state?.error

  // Loading always reads the saved settings, so unsaved edits are saved first.
  const saveAndLoad = async () => {
    if (dirty && !(await save())) return
    await load()
  }

  const reloading = status === 'ready'
  const loadLabel = dirty ? `Save and ${reloading ? 'reload' : 'load'}` : reloading ? 'Reload' : 'Load model'

  const outdated =
    status === 'ready' &&
    saved !== null &&
    !dirty &&
    (state?.model !== configuredModel(saved) || state?.provider !== saved.llm.provider)

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[13px] font-medium">
            <StatusDot status={status} />
            {statusLabel(status, draft?.llm.provider ?? null)}
          </p>
          {active?.model ? (
            <p className="mt-1.5 font-mono text-[13px] break-all">{active.model}</p>
          ) : (
            <p className="mt-1.5 text-[13px] text-ink-muted">Nothing is in memory.</p>
          )}
          {active?.provider && <p className="text-xs text-ink-faint">{PROVIDERS[active.provider].label}</p>}
        </div>

        <div className="flex shrink-0 gap-2">
          {status === 'loading' ? (
            <Button onClick={unload}>Cancel</Button>
          ) : (
            <>
              {status === 'ready' && <Button onClick={unload}>Unload</Button>}
              <Button variant="primary" onClick={saveAndLoad} disabled={!target || saving}>
                {loadLabel}
              </Button>
            </>
          )}
        </div>
      </div>

      {status === 'loading' && <div className="shimmer mt-4 h-1 rounded-full" />}

      {status === 'ready' && state && (
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 border-t border-line pt-3 text-[13px]">
          {Object.entries(state.details).map(([name, value]) => (
            <div key={name} className="col-span-2 grid grid-cols-subgrid">
              <dt className="text-ink-muted">{name}</dt>
              <dd className="font-mono text-xs leading-5 break-all">{value}</dd>
            </div>
          ))}
          {state.load_seconds !== null && (
            <div className="col-span-2 grid grid-cols-subgrid">
              <dt className="text-ink-muted">ready after</dt>
              <dd className="font-mono text-xs leading-5">{state.load_seconds}s</dd>
            </div>
          )}
        </dl>
      )}

      {problem && (
        <p role="alert" className="mt-3 text-[13px] text-danger">
          {problem}
        </p>
      )}
      {outdated && (
        <p className="mt-3 text-[13px] text-warn">
          The settings now point at a different model than the one in memory. Reload to switch.
        </p>
      )}
      {!target && <p className="mt-3 text-[13px] text-ink-muted">Choose a model above to load it.</p>}
    </div>
  )
}
