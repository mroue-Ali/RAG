import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, errorMessage } from '../lib/api'
import type { AppSettings } from '../lib/types'
import { SettingsContext, useModel } from './contexts'

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { offline, refresh } = useModel()
  const [saved, setSaved] = useState<AppSettings | null>(null)
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Runs again when the backend comes back, in case the first attempt found it down.
  const missing = saved === null
  useEffect(() => {
    if (offline || !missing) return
    let current = true
    api
      .settings()
      .then((settings) => {
        if (!current) return
        setSaved(settings)
        setDraft(settings)
        setError(null)
      })
      .catch((failure) => {
        if (current) setError(errorMessage(failure))
      })
    return () => {
      current = false
    }
  }, [offline, missing])

  const edit = useCallback((change: (draft: AppSettings) => AppSettings) => {
    setDraft((current) => current && change(current))
  }, [])

  const save = useCallback(async () => {
    if (!draft) return false
    setSaving(true)
    setError(null)
    try {
      const stored = await api.saveSettings(draft)
      setSaved(stored)
      setDraft(stored)
      // For an API provider the model state is derived from these settings.
      refresh()
      return true
    } catch (failure) {
      setError(errorMessage(failure))
      return false
    } finally {
      setSaving(false)
    }
  }, [draft, refresh])

  const discard = useCallback(() => {
    setDraft(saved)
    setError(null)
  }, [saved])

  const dirty = useMemo(() => JSON.stringify(saved) !== JSON.stringify(draft), [saved, draft])

  const value = useMemo(
    () => ({ saved, draft, dirty, saving, error, edit, save, discard }),
    [saved, draft, dirty, saving, error, edit, save, discard],
  )

  return <SettingsContext value={value}>{children}</SettingsContext>
}
