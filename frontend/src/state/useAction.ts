import { useCallback, useState } from 'react'
import { errorMessage } from '../lib/api'

/** Pending and error state for one button or form that calls the server. */
export function useAction() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Resolves to true when the action went through; otherwise `error` says why. */
  const run = useCallback(async (action: () => Promise<unknown>) => {
    setPending(true)
    setError(null)
    try {
      await action()
      return true
    } catch (failure) {
      setError(errorMessage(failure))
      return false
    } finally {
      setPending(false)
    }
  }, [])

  return { pending, error, run, clearError: useCallback(() => setError(null), []) }
}
