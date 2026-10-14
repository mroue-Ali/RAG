import { Check, Copy } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { IconButton } from './Button'

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copy = () => {
    // Rejects outside a secure context; the button then simply does not confirm.
    navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => {},
    )
  }

  return (
    <IconButton label={copied ? 'Copied' : label} onClick={copy}>
      {copied ? <Check size={15} className="text-accent" /> : <Copy size={15} />}
    </IconButton>
  )
}
