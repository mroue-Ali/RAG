import { FolderOpen } from '@phosphor-icons/react'
import { useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { Button } from '../ui/Button'

interface FolderPickerProps {
  /** The chosen folder. Empty means the Hugging Face cache. */
  value: string
  onChange: (path: string) => void
}

/** Pick a folder with the system dialog, which the backend opens on its own machine. */
export function FolderPicker({ value, onChange }: FolderPickerProps) {
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const browse = async () => {
    setPicking(true)
    setError(null)
    try {
      const { path } = await api.pickFolder(value)
      if (path) onChange(path)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setPicking(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] font-medium">Models directory</p>
      <div className="flex items-center gap-2 rounded-lg border border-line py-1 pr-1 pl-3">
        <FolderOpen size={16} className="shrink-0 text-ink-faint" />
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]" title={value || undefined}>
          {value || <span className="font-sans text-ink-muted">Hugging Face cache</span>}
        </span>
        {value && (
          <Button variant="ghost" size="sm" onClick={() => onChange('')}>
            Use cache
          </Button>
        )}
        <Button size="sm" onClick={browse} disabled={picking}>
          {picking ? 'Waiting for the dialog' : 'Browse'}
        </Button>
      </div>
      {error ? (
        <p className="text-[13px] text-danger">{error}</p>
      ) : (
        <p className="text-[13px] text-ink-muted">Every model folder inside it is listed below.</p>
      )}
    </div>
  )
}
