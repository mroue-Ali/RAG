// Sign in with Google, through Google Identity Services. The script is only
// fetched on an instance that has a client ID configured.

interface GoogleIdentity {
  initialize(options: { client_id: string; callback: (response: { credential: string }) => void }): void
  renderButton(parent: HTMLElement, options: Record<string, string | number>): void
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdentity } }
  }
}

const SCRIPT_URL = 'https://accounts.google.com/gsi/client'

let pending: Promise<GoogleIdentity> | null = null

export function loadGoogleIdentity(): Promise<GoogleIdentity> {
  pending ??= new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () => {
      if (window.google) resolve(window.google.accounts.id)
      else reject(new Error('Google sign-in did not load.'))
    }
    script.onerror = () => {
      // Let a later attempt try again instead of caching the failure.
      pending = null
      reject(new Error('Google sign-in could not be reached.'))
    }
    document.head.append(script)
  })
  return pending
}
