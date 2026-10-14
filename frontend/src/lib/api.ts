import type {
  AdminAccount,
  AppSettings,
  ChatEvent,
  DatabaseStatus,
  FolderPick,
  GeneralSettings,
  Health,
  LLMState,
  MemberInfo,
  ModelsRequest,
  ModelsResponse,
  NewUser,
  PromptPreview,
  PromptSettings,
  PromptVariable,
  SessionInfo,
  UserUpdate,
} from './types'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** A message fit to show the user, whatever was thrown. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const UNREACHABLE = 'The backend is not responding. Check that it is running on port 8000.'

let onSignedOut: (() => void) | null = null

/** Called whenever the server answers that nobody is signed in: the session expired or was ended elsewhere. */
export function setSignedOutHandler(handler: (() => void) | null) {
  onSignedOut = handler
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(UNREACHABLE, 0)
  }
  if (response.status === 401) onSignedOut?.()
  if (!response.ok) throw new ApiError(await readError(response), response.status)
  return response
}

async function readError(response: Response): Promise<string> {
  const body = await response.text()
  try {
    const { detail } = JSON.parse(body)
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) {
      // FastAPI validation errors: one entry per rejected field.
      return detail.map((issue) => `${(issue.loc ?? []).slice(1).join('.')}: ${issue.msg}`).join('. ')
    }
  } catch {
    // Not JSON: the dev proxy answers like this when the backend is down.
  }
  return response.status >= 500 ? UNREACHABLE : `Request failed (${response.status}).`
}

async function get<T>(path: string): Promise<T> {
  return (await send(path)).json()
}

async function call<T>(method: 'POST' | 'PUT' | 'PATCH', path: string, body?: unknown): Promise<T> {
  const init = {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  }
  return (await send(path, init)).json()
}

async function remove(path: string): Promise<void> {
  await send(path, { method: 'DELETE' })
}

export const api = {
  health: () => get<Health>('/health'),

  session: () => get<SessionInfo>('/auth/session'),
  setup: (account_name: string, username: string, password: string) =>
    call<SessionInfo>('POST', '/auth/setup', {
      account_name,
      username,
      password,
    }),
  register: (username: string, password: string) => call<SessionInfo>('POST', '/auth/register', { username, password }),
  login: (username: string, password: string) => call<SessionInfo>('POST', '/auth/login', { username, password }),
  googleSignIn: (credential: string) => call<SessionInfo>('POST', '/auth/google', { credential }),
  logout: () => call<SessionInfo>('POST', '/auth/logout'),

  updateProfile: (display_name: string) => call<SessionInfo>('PATCH', '/me', { display_name }),
  changePassword: (current_password: string, new_password: string) =>
    call<SessionInfo>('PUT', '/me/password', {
      current_password,
      new_password,
    }),

  renameAccount: (name: string) => call<SessionInfo>('PATCH', '/account', { name }),
  users: () => get<MemberInfo[]>('/account/users'),
  addUser: (user: NewUser) => call<MemberInfo>('POST', '/account/users', user),
  updateUser: (id: number, change: UserUpdate) => call<MemberInfo>('PATCH', `/account/users/${id}`, change),
  removeUser: (id: number) => remove(`/account/users/${id}`),

  allAccounts: () => get<AdminAccount[]>('/admin/accounts'),
  deleteAccount: (id: number) => remove(`/admin/accounts/${id}`),
  setSuperadmin: (id: number, is_superadmin: boolean) =>
    call<MemberInfo>('PATCH', `/admin/users/${id}`, { is_superadmin }),
  database: () => get<DatabaseStatus>('/admin/database'),

  settings: () => get<AppSettings>('/settings'),
  defaultSettings: () => get<AppSettings>('/settings/defaults'),
  saveSettings: (settings: AppSettings) => call<AppSettings>('PUT', '/settings', settings),

  modelState: () => get<LLMState>('/llm/status'),
  loadModel: () => call<LLMState>('POST', '/llm/load'),
  unloadModel: () => call<LLMState>('POST', '/llm/unload'),
  listModels: (request: ModelsRequest) => call<ModelsResponse>('POST', '/llm/models', request),
  pickFolder: (start: string) => call<FolderPick>('POST', '/llm/pick-folder', { path: start || null }),

  promptVariables: () => get<PromptVariable[]>('/prompt/variables'),
  previewPrompt: (prompt: PromptSettings, general: GeneralSettings, question: string) =>
    call<PromptPreview>('POST', '/prompt/preview', {
      prompt,
      general,
      question,
    }),
}

/** Send the conversation and yield the reply's events as they arrive. */
export async function* streamChat(
  messages: { role: 'user' | 'assistant'; content: string }[],
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const response = await send('/chat/stream', {
    method: 'POST',
    body: JSON.stringify({ messages }),
    signal,
  })
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += value
    // Server-sent events: frames end with a blank line, payload follows "data:".
    let end: number
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      if (frame.startsWith('data:')) yield JSON.parse(frame.slice(5))
    }
  }
}
