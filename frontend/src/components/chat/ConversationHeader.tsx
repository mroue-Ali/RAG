import { PencilSimple, Trash } from '@phosphor-icons/react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAction } from '../../state/useAction'
import { HeaderBar, PageHeader } from '../layout/AppShell'
import { Button, IconButton } from '../ui/Button'
import { TextInput } from '../ui/Field'

interface ConversationHeaderProps {
  title: string
  onRename: (title: string) => Promise<void>
  /** Resolves once the conversation is gone. */
  onDelete: () => Promise<void>
}

/** A saved conversation's title, with renaming and deleting. */
export function ConversationHeader({ title, onRename, onDelete }: ConversationHeaderProps) {
  const [mode, setMode] = useState<'view' | 'rename' | 'delete'>('view')
  const [draft, setDraft] = useState(title)
  const { pending, error, run, clearError } = useAction()

  const close = () => {
    setMode('view')
    clearError()
  }

  const rename = async (event: FormEvent) => {
    event.preventDefault()
    const next = draft.trim()
    if (!next || next === title) return close()
    if (await run(() => onRename(next))) close()
  }

  return (
    <>
      {mode === 'rename' ? (
        <HeaderBar>
          <form onSubmit={rename} className="flex min-w-0 flex-1 items-center gap-2">
            <TextInput
              autoFocus
              value={draft}
              maxLength={200}
              aria-label="Conversation title"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => event.key === 'Escape' && close()}
              className="min-w-0 flex-1 font-semibold"
            />
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={pending}>
              Save
            </Button>
          </form>
        </HeaderBar>
      ) : (
        <PageHeader title={title}>
          <IconButton
            label="Rename"
            onClick={() => {
              setDraft(title)
              setMode('rename')
            }}
          >
            <PencilSimple size={16} />
          </IconButton>
          <IconButton label="Delete" onClick={() => setMode('delete')}>
            <Trash size={16} />
          </IconButton>
        </PageHeader>
      )}

      {mode === 'delete' && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-danger/10 px-4 py-2.5 md:px-6">
          <p className="flex-1 text-[13px] text-danger">
            Delete this conversation and all its messages? This cannot be undone.
          </p>
          <Button size="sm" onClick={close}>
            Keep
          </Button>
          <Button size="sm" variant="primary" disabled={pending} onClick={() => run(onDelete)}>
            Delete
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="border-b border-line px-4 py-2 text-[13px] text-danger md:px-6">
          {error}
        </p>
      )}
    </>
  )
}
