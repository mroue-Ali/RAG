import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, errorMessage } from '../lib/api'
import type { LLMState } from '../lib/types'
import { ModelContext } from './contexts'

const POLL_LOADING_MS = 1000
// Slow enough to be free, fast enough to notice a restarted backend.
const POLL_IDLE_MS = 10000

export function ModelProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LLMState | null>(null)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshes, setRefreshes] = useState(0)
  const refresh = useCallback(() => setRefreshes((count) => count + 1), [])

  const loading = state?.status === 'loading'
  useEffect(() => {
    let current = true
    const check = async () => {
      try {
        const next = await api.modelState()
        if (current) {
          setState(next)
          setOffline(false)
        }
      } catch {
        if (current) setOffline(true)
      }
    }
    void check()
    const timer = window.setInterval(check, loading ? POLL_LOADING_MS : POLL_IDLE_MS)
    return () => {
      current = false
      window.clearInterval(timer)
    }
  }, [loading, refreshes])

  const request = useCallback(async (action: () => Promise<LLMState>) => {
    setError(null)
    try {
      setState(await action())
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }, [])

  const value = useMemo(
    () => ({
      state,
      offline,
      error,
      load: () => request(api.loadModel),
      unload: () => request(api.unloadModel),
      refresh,
    }),
    [state, offline, error, request, refresh],
  )

  return <ModelContext value={value}>{children}</ModelContext>
}
