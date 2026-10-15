import { createContext, use } from 'react'
import type { AppSettings, ConversationInfo, LLMState, MessageInfo, Permission, SessionInfo } from '../lib/types'

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

// --- Conversations -------------------------------------------------------------

/** A message as the chat shows it: a stored one, or one still on its way. */
export interface Message extends Omit<MessageInfo, 'id' | 'provider' | 'created_at'> {
  /** For React. It stays the same when the server's copy replaces a message still on its way. */
  key: string
  /** The stored id. null until the server has stored the message. */
  id: number | null
  /** The reply is still being written. */
  pending?: boolean
}

/** One conversation's messages and what is happening to them. */
export interface Thread {
  messages: Message[]
  /** A reply is being written. */
  streaming: boolean
  /** The stored messages are being fetched. */
  loading: boolean
  /** Why they could not be fetched. */
  error: string | null
  /** Why the last question did not go through. Nothing was stored. */
  notSent: string | null
}

export interface ConversationsContextValue {
  /** The signed-in user's conversations, most recent activity first. null until loaded. */
  list: ConversationInfo[] | null
  /** Every thread opened so far, by threadKey. Read one with useThread. */
  threads: Record<string, Thread>
  /** Fetch a saved conversation's messages, unless they are here already. */
  open: (id: number) => void
  /**
   * Ask a question in a conversation, or start one with it (id null). Resolves
   * to the conversation's id as soon as the server has stored the question, or
   * to null when it was not sent; the thread's `notSent` then says why.
   */
  send: (id: number | null, text: string) => Promise<number | null>
  /** Throw away `reply`, the conversation's last, and ask again. */
  regenerate: (id: number, reply: Message) => void
  /** Stop the reply being written in this conversation. What came so far is kept. */
  stop: (id: number | null) => void
  /** These reject with a message fit to show. */
  rename: (id: number, title: string) => Promise<void>
  remove: (id: number) => Promise<void>
}

export const ConversationsContext = createContext<ConversationsContextValue | null>(null)

/** Where a thread is kept: its conversation's id, or "new" for the conversation being started. */
export const threadKey = (id: number | null) => (id === null ? 'new' : String(id))

export const EMPTY_THREAD: Thread = { messages: [], streaming: false, loading: false, error: null, notSent: null }

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
export const useConversations = () => required(use(ConversationsContext), 'ConversationsProvider')

/** A conversation's thread, or the new one's (id null). undefined for a saved conversation not opened yet. */
export function useThread(id: number | null): Thread | undefined {
  const { threads } = useConversations()
  return threads[threadKey(id)] ?? (id === null ? EMPTY_THREAD : undefined)
}
