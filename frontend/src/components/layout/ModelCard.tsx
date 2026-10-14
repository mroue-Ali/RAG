import { Link } from 'react-router'
import { isLocal, PROVIDERS, statusLabel } from '../../lib/providers'
import { useCan, useModel } from '../../state/contexts'
import { useModelSummary } from '../../state/useModelSummary'
import { Button } from '../ui/Button'
import { buttonClass } from '../ui/buttonStyles'
import { StatusDot } from '../ui/StatusDot'

/** The model's state, visible from every page, with the next step where there is one. */
export function ModelCard() {
  const manage = useCan('model.manage')
  const { state, error, load, unload } = useModel()
  const { status, model, provider, configured } = useModelSummary()
  const problem = error ?? state?.error

  return (
    <section aria-label="Model" className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-center gap-2 text-xs text-ink-muted">
        <StatusDot status={status} />
        {statusLabel(status, provider)}
      </div>
      <p className="mt-1.5 truncate font-mono text-[13px] text-ink" title={model}>
        {model || 'No model selected'}
      </p>
      {provider && model && <p className="truncate text-xs text-ink-faint">{PROVIDERS[provider].label}</p>}
      {problem && <p className="mt-2 line-clamp-4 text-xs text-danger">{problem}</p>}

      {!manage ? null : !configured && status === 'unloaded' ? (
        <Link to="/settings" className={buttonClass('secondary', 'sm', 'mt-3 w-full')}>
          Open settings
        </Link>
      ) : !isLocal(provider) ? null : status === 'ready' || status === 'loading' ? (
        // Only a local provider holds a model in memory, so only it has anything to load or unload.
        <Button size="sm" className="mt-3 w-full" onClick={unload}>
          {status === 'loading' ? 'Cancel' : 'Unload'}
        </Button>
      ) : (
        <Button size="sm" variant="primary" className="mt-3 w-full" onClick={load}>
          {status === 'error' ? 'Try again' : 'Load model'}
        </Button>
      )}
    </section>
  )
}
