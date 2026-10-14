import { CheckCircle } from '@phosphor-icons/react'
import { useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { configuredModel } from '../../lib/providers'
import { useSettings } from '../../state/contexts'
import { Button } from '../ui/Button'

/**
 * The API counterpart of the runtime panel. Nothing is loaded for an API
 * provider, so the one useful action is checking that it answers.
 */
export function ConnectionPanel() {
  const { draft, dirty, saving, save } = useSettings()
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const target = draft ? configuredModel(draft) : ''

  const test = async () => {
    setTesting(true)
    setResult(null)
    try {
      // The test reads the saved settings. A failed save reports itself in the page footer.
      if (dirty && !(await save())) return
      const state = await api.loadModel()
      setResult({ ok: true, text: `${state.details.endpoint ?? 'The provider'} answered and offers ${state.model}.` })
    } catch (failure) {
      setResult({ ok: false, text: errorMessage(failure) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <p className="max-w-[48ch] text-[13px] text-ink-muted">
          {target
            ? 'Check that your provider accepts this address, key and model before you rely on them.'
            : 'Fill in the address and a model above, then test the connection.'}
        </p>
        <Button variant="primary" onClick={test} disabled={!target || testing || saving}>
          {testing ? 'Testing' : dirty ? 'Save and test' : 'Test connection'}
        </Button>
      </div>
      {testing && <div className="shimmer mt-4 h-1 rounded-full" />}
      {result && (
        <p
          role={result.ok ? 'status' : 'alert'}
          className={`mt-3 flex items-start gap-2 text-[13px] ${result.ok ? 'text-accent' : 'text-danger'}`}
        >
          {result.ok && <CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0" />}
          {result.text}
        </p>
      )}
    </div>
  )
}
