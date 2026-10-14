import { createContext, use } from 'react'
import type { AppSettings, LLMState, Permission, SessionInfo } from '../lib/types'

// --- Session -------------------------------------------------------------------

export interface AuthContextValue {
  session: SessionInfo
  /** These reject with a message fit to show beside the form. */
  setUp: (accountName: string, username: string, password: string) => Promise<void>
  signIn: (username: string, password: string) => Promise<void>
  signUp: (username: string, password: string) => Promise<void>
  signInWithGoogle: (credential: string) => Promise<void>
  signOut: () => Promise<void>
  /** Take a session the server sent back after a profile or account change. */
  update: (session: SessionInfo) => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

// --- Model runtime -------------------------------------------------------------

export interface ModelContextValue {
  /** null until the first answer from the backend. */
  state: LLMState | null
  /** The backend did not answer the last status check. */
  offline: boolean
  /** Why the last load or unload request was refused, if it was. */
  error: string | null
  load: () => Promise<void>
  unload: () => Promise<void>
  /** Ask the backend for the state now instead of waiting for the next poll. */
  refresh: () => void
}

export const ModelContext = createContext<ModelContextValue | null>(null)

// --- Settings ------------------------------------------------------------------

export interface SettingsContextValue {
  /** What the server has. null until loaded. */
  saved: AppSettings | null
  /** What the settings form shows. Differs from saved while there are unsaved edits. */
  draft: AppSettings | null
  dirty: boolean
  saving: boolean
  error: string | null
  edit: (change: (draft: AppSettings) => AppSettings) => void
  /** Resolves to true when the server accepted the draft. */
  save: () => Promise<boolean>
  discard: () => void
}

export const SettingsContext = createContext<SettingsContextValue | null>(null)

// --- Chat ----------------------------------------------------------------------

export interface MessageStats {
  finishReason: string | null
  completionTokens: number | null
  seconds: number
  generationSeconds: number | null
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** Thinking tokens the server reported separately from the answer. */
  reasoning?: string
  model?: string
  /** Still being generated. */
  pending?: boolean
  /** Cut short by the user. */
  stopped?: boolean
  error?: string
  stats?: MessageStats
}

export interface ChatContextValue {
  messages: Message[]
  streaming: boolean
  send: (text: string) => void
  stop: () => void
  /** Throw away the last reply and ask again. */
  regenerate: () => void
  clear: () => void
}

export const ChatContext = createContext<ChatContextValue | null>(null)

// --- Hooks ---------------------------------------------------------------------

function required<T>(value: T | null, provider: string): T {
  if (value === null) throw new Error(`Missing <${provider}> above this component.`)
  return value
}

export const useAuth = () => required(use(AuthContext), 'AuthProvider')
/** Whether the signed-in user's role allows this. The server checks again; this only shapes the UI. */
export const useCan = (permission: Permission) => useAuth().session.permissions.includes(permission)
export const useModel = () => required(use(ModelContext), 'ModelProvider')
export const useSettings = () => required(use(SettingsContext), 'SettingsProvider')
export const useChat = () => required(use(ChatContext), 'ChatProvider')
