import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AppShell } from './components/layout/AppShell'
import { AdminPage } from './pages/AdminPage'
import { AuthPage } from './pages/AuthPage'
import { ChatPage } from './pages/ChatPage'
import { SettingsPage } from './pages/SettingsPage'
import { AuthProvider } from './state/AuthProvider'
import { ChatProvider } from './state/ChatProvider'
import { ModelProvider } from './state/ModelProvider'
import { SettingsProvider } from './state/SettingsProvider'
import { useAuth } from './state/contexts'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Workspace />
      </AuthProvider>
    </BrowserRouter>
  )
}

/** The app itself, for whoever is signed in. Until someone is, the front door: setup, sign-in or sign-up. */
function Workspace() {
  const { session } = useAuth()
  if (!session.user) return <AuthPage />

  return (
    // Above the routes on purpose: model state, settings edits and the conversation
    // survive navigation. Keyed by user, so signing in as someone else starts clean.
    <ModelProvider key={session.user.id}>
      <SettingsProvider>
        <ChatProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<ChatPage />} />
              <Route path="settings/:section?" element={<SettingsPage />} />
              <Route path="admin" element={<AdminPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </ChatProvider>
      </SettingsProvider>
    </ModelProvider>
  )
}

export default App
