import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Wordmark } from '../components/layout/Wordmark'
import { Button } from '../components/ui/Button'
import { Field, TextInput } from '../components/ui/Field'
import { errorMessage } from '../lib/api'
import { loadGoogleIdentity } from '../lib/google'
import { useAuth } from '../state/contexts'

type Form = 'setup' | 'sign-in' | 'sign-up'

const COPY: Record<Form, { title: string; intro: string; submit: string }> = {
  setup: {
    title: 'Set up rag',
    intro:
      'You are the first one here. This creates the account that holds your data, with you as its owner and the person who runs this instance. You can add people afterwards.',
    submit: 'Create account',
  },
  'sign-in': { title: 'Sign in', intro: '', submit: 'Sign in' },
  'sign-up': {
    title: 'Create your account',
    intro: 'Free trial, open to everyone. You get an account of your own, and can add people to it later.',
    submit: 'Create account',
  },
}

/** The front door: setup on a new instance, then sign in, and sign up where it is open. */
export function AuthPage() {
  const { session, setUp, signIn, signUp, signInWithGoogle } = useAuth()
  const [creating, setCreating] = useState(false)
  const [accountName, setAccountName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const form: Form = session.signup === 'setup' ? 'setup' : creating && session.signup === 'open' ? 'sign-up' : 'sign-in'
  const copy = COPY[form]
  const newPassword = form !== 'sign-in'

  // On success the session changes and this page is replaced, so only failure needs handling.
  const attempt = useCallback(async (action: () => Promise<void>) => {
    setPending(true)
    setError(null)
    try {
      await action()
    } catch (failure) {
      setError(errorMessage(failure))
      setPending(false)
    }
  }, [])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void attempt(() => {
      if (form === 'setup') return setUp(accountName, username, password)
      return (form === 'sign-up' ? signUp : signIn)(username, password)
    })
  }

  const withGoogle = useCallback(
    (credential: string) => void attempt(() => signInWithGoogle(credential)),
    [attempt, signInWithGoogle],
  )

  const switchForm = () => {
    setCreating(!creating)
    setError(null)
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Wordmark />
        <h1 className="mt-10 text-2xl font-semibold tracking-tight">{copy.title}</h1>
        {copy.intro && <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{copy.intro}</p>}

        <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
          {form === 'setup' && (
            <Field label="Account name" hint="Yours, a family's or a team's. You can rename it later.">
              {(id) => (
                <TextInput
                  id={id}
                  value={accountName}
                  onChange={(event) => setAccountName(event.target.value)}
                  maxLength={120}
                  placeholder="Home"
                  required
                  autoFocus
                />
              )}
            </Field>
          )}
          <Field label="Username">
            {(id) => (
              <TextInput
                id={id}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                autoFocus={form !== 'setup'}
              />
            )}
          </Field>
          <Field label="Password" hint={newPassword ? 'At least 8 characters. No email is needed.' : undefined}>
            {(id) => (
              <TextInput
                id={id}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={newPassword ? 'new-password' : 'current-password'}
                required
              />
            )}
          </Field>
          {error && (
            <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={pending} className="mt-1 w-full">
            {pending ? 'One moment' : copy.submit}
          </Button>
        </form>

        {form !== 'setup' && session.google_client_id && (
          <>
            <p className="my-5 flex items-center gap-3 text-xs text-ink-faint before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
              or
            </p>
            <GoogleButton clientId={session.google_client_id} onCredential={withGoogle} />
          </>
        )}

        {session.signup === 'open' && (
          <p className="mt-8 text-[13px] text-ink-muted">
            {creating ? 'Already have an account?' : 'New here?'}{' '}
            <button type="button" onClick={switchForm} className="font-medium text-ink underline underline-offset-4">
              {creating ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        )}
        {session.signup === 'closed' && (
          <p className="mt-8 text-[13px] text-ink-muted">No account yet? Ask an admin of this instance to add you.</p>
        )}
      </div>
    </main>
  )
}

/** Google draws its own button inside the element we give it. */
function GoogleButton({ clientId, onCredential }: { clientId: string; onCredential: (credential: string) => void }) {
  const holder = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let current = true
    loadGoogleIdentity().then(
      (google) => {
        const element = holder.current
        if (!current || !element) return
        google.initialize({ client_id: clientId, callback: (response) => onCredential(response.credential) })
        google.renderButton(element, {
          type: 'standard',
          size: 'large',
          text: 'continue_with',
          theme: document.documentElement.dataset.theme === 'dark' ? 'filled_black' : 'outline',
          width: element.offsetWidth,
        })
      },
      () => current && setFailed(true),
    )
    return () => {
      current = false
    }
  }, [clientId, onCredential])

  if (failed) return <p className="text-[13px] text-ink-muted">Google sign-in is not reachable right now.</p>
  return <div ref={holder} className="min-h-11" />
}
