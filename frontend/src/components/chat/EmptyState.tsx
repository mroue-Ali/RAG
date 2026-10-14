import { ChatCircleText, Cpu, UserGear, Warning } from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { isLocal } from '../../lib/providers'
import { useCan, useModel, useSettings } from '../../state/contexts'
import { useModelSummary } from '../../state/useModelSummary'
import { Button } from '../ui/Button'
import { buttonClass } from '../ui/buttonStyles'

/** What the chat page shows before the first message: where things stand and the next step. */
export function EmptyState() {
  const manage = useCan('model.manage')
  const { state, error, load, unload } = useModel()
  const { saved } = useSettings()
  const { status, model, provider, configured } = useModelSummary()

  if (!saved || !state) {
    return (
      <div className="my-auto flex max-w-md flex-col gap-3" aria-busy="true" aria-label="Loading">
        <div className="shimmer size-10 rounded-xl" />
        <div className="shimmer h-5 w-48 rounded-lg" />
        <div className="shimmer h-4 w-72 rounded-lg" />
      </div>
    )
  }

  if (status === 'ready') {
    return (
      <Layout icon={ChatCircleText} title="Start a conversation">
        <p>
          <Mono>{model}</Mono> is {isLocal(provider) ? 'loaded' : 'set up'}. Every message goes out with the
          account's prompt template.
        </p>
        {manage && (
          <Actions>
            <Link to="/settings/prompt" className={buttonClass()}>
              Edit the prompt
            </Link>
          </Actions>
        )}
      </Layout>
    )
  }

  // Choosing and loading the model is for the account's admins. Everyone else waits for them.
  if (!manage) {
    return (
      <Layout icon={UserGear} title="The model is not ready yet">
        <p>An admin of this account chooses the model and gets it ready. Ask one of them, then come back here.</p>
      </Layout>
    )
  }

  if (status === 'loading') {
    return (
      <Layout icon={Cpu} title="Loading the model">
        <p>
          <Mono>{model}</Mono> is being loaded. Large models take a while, and a Hugging Face model that is not
          on disk yet is downloaded first.
        </p>
        <div className="shimmer h-1 w-full rounded-full" />
        <Actions>
          <Button onClick={unload}>Cancel</Button>
        </Actions>
      </Layout>
    )
  }

  if (status === 'error') {
    return (
      <Layout icon={Warning} title="The model did not load">
        <p className="text-danger">{state.error}</p>
        <Actions>
          <Button variant="primary" onClick={load}>
            Try again
          </Button>
          <Link to="/settings" className={buttonClass()}>
            Open settings
          </Link>
        </Actions>
      </Layout>
    )
  }

  if (!configured) {
    return (
      <Layout icon={Cpu} title="Choose a model first">
        <p>
          Pick a provider and a model in Settings. A model on this machine is then loaded; an API only needs its
          address and key.
        </p>
        <Actions>
          <Link to="/settings" className={buttonClass('primary')}>
            Open settings
          </Link>
        </Actions>
      </Layout>
    )
  }

  return (
    <Layout icon={Cpu} title="No model loaded">
      <p>
        Load <Mono>{model}</Mono> to start chatting.
      </p>
      {error && <p className="text-danger">{error}</p>}
      <Actions>
        <Button variant="primary" onClick={load}>
          Load model
        </Button>
        <Link to="/settings" className={buttonClass()}>
          Change model
        </Link>
      </Actions>
    </Layout>
  )
}

function Layout({ icon: StateIcon, title, children }: { icon: Icon; title: string; children: ReactNode }) {
  return (
    <div className="my-auto flex max-w-md flex-col gap-3 text-[15px] leading-relaxed text-ink-muted">
      <span className="grid size-10 place-items-center rounded-xl bg-sunken text-ink">
        <StateIcon size={20} />
      </span>
      <h2 className="text-xl font-semibold tracking-tight text-ink">{title}</h2>
      {children}
    </div>
  )
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-2 flex flex-wrap gap-2">{children}</div>
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[13px] break-all text-ink">{children}</span>
}
