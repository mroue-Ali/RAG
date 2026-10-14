import { WifiSlash } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { Outlet } from 'react-router'
import { useModel } from '../../state/contexts'
import { Sidebar } from './Sidebar'

export function AppShell() {
  const { offline } = useModel()

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      <Sidebar />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {offline && (
          <p role="alert" className="flex items-center gap-2 border-b border-line bg-danger/10 px-4 py-2 text-[13px] text-danger">
            <WifiSlash size={16} className="shrink-0" />
            The backend is not responding. Start it on port 8000 and this will reconnect on its own.
          </p>
        )}
        <Outlet />
      </main>
    </div>
  )
}

/** The strip at the top of each page: its title on the left, its actions on the right. */
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line px-4 md:px-6">
      <h1 className="text-[15px] font-semibold tracking-tight">{title}</h1>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </header>
  )
}
