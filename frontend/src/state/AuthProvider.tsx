import { StackSimple } from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, setSignedOutHandler } from '../lib/api'
import type { SessionInfo } from '../lib/types'
import { AuthContext } from './contexts'

const RETRY_MS = 3000

/**
 * Finds out who is using the app before anything else renders. Children only
 * mount once the backend has answered, so they can rely on a session existing.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    let retry: number | undefined
    api.session().then(
      (info) => {
        if (!current) return
        setSession(info)
        setUnreachable(false)
      },
      () => {
        if (!current) return
        setUnreachable(true)
        retry = window.setTimeout(() => setAttempt((count) => count + 1), RETRY_MS)
      },
    )
    return () => {
      current = false
      window.clearTimeout(retry)
    }
  }, [attempt])

  // Any request can discover that the session is over. Drop the user, and the sign-in page takes over.
  useEffect(() => {
    setSignedOutHandler(() => setSession((known) => known && { ...known, user: null }))
    return () => setSignedOutHandler(null)
  }, [])

  const setUp = useCallback(async (accountName: string, username: string, password: string) => {
    setSession(await api.setup(accountName, username, password))
  }, [])
  const signIn = useCallback(async (username: string, password: string) => {
    setSession(await api.login(username, password))
  }, [])
  const signUp = useCallback(async (username: string, password: string) => {
    setSession(await api.register(username, password))
  }, [])
  const signInWithGoogle = useCallback(async (credential: string) => {
    setSession(await api.googleSignIn(credential))
  }, [])
  const signOut = useCallback(async () => {
    setSession(await api.logout())
  }, [])

  const value = useMemo(
    () => (session ? { session, setUp, signIn, signUp, signInWithGoogle, signOut, update: setSession } : null),
    [session, setUp, signIn, signUp, signInWithGoogle, signOut],
  )

  if (!value) {
    return (
      <div className="grid min-h-dvh place-items-center px-4" aria-busy={!unreachable}>
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <span className="grid size-10 place-items-center rounded-xl bg-ink text-canvas">
            <StackSimple size={20} weight="fill" />
          </span>
          {unreachable ? (
            <p role="alert" className="text-[15px] text-ink-muted">
              The backend is not responding. Start it on port 8000 and this page will carry on by itself.
            </p>
          ) : (
            <div className="shimmer h-1 w-32 rounded-full" role="status" aria-label="Starting" />
          )}
        </div>
      </div>
    )
  }

  return <AuthContext value={value}>{children}</AuthContext>
}
