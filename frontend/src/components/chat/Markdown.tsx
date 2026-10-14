import { isValidElement, memo } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CopyButton } from '../ui/CopyButton'

/**
 * Model output rendered as Markdown. Raw HTML in the text is shown as text, never run.
 * dir="auto" lets right-to-left replies (Arabic, Hebrew) lay out correctly.
 */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="prose" dir="auto">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: CodeBlock, a: ExternalLink }}>
        {text}
      </ReactMarkdown>
    </div>
  )
})

function CodeBlock({ children }: ComponentProps<'pre'>) {
  const code = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children.props : null
  const language = code?.className?.match(/language-([\w+-]+)/)?.[1]

  return (
    <div dir="ltr" className="code-block overflow-hidden rounded-xl border border-line bg-sunken/60">
      <div className="flex h-9 items-center justify-between border-b border-line pr-1 pl-4">
        <span className="font-mono text-xs text-ink-faint">{language ?? 'text'}</span>
        <CopyButton text={String(code?.children ?? '')} label="Copy code" />
      </div>
      <pre>{children}</pre>
    </div>
  )
}

function ExternalLink({ href, children }: ComponentProps<'a'>) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}
