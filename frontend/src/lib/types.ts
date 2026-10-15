// Mirrors backend/app/schemas.py.

export type ProviderKind = 'transformers' | 'lmstudio' | 'openai'
/** Inside an account. What each may do is in backend/app/services/roles.py. */
export type Role = 'owner' | 'admin' | 'member'
/** The roles an owner or admin can hand out. There is one owner per account. */
export type AssignableRole = Exclude<Role, 'owner'>
export type Permission = 'chat' | 'model.manage' | 'users.manage' | 'account.manage'

export interface LMStudioConfig {
  base_url: string
  model: string
}

export interface OpenAIConfig {
  base_url: string
  model: string
  /** Write-only. null keeps the stored key, '' removes it. The server never sends it back. */
  api_key: string | null
  api_key_set: boolean
}

export interface TransformersConfig {
  /** Where to look for models. Empty means the Hugging Face cache. */
  models_dir: string
  model: string
  device: 'auto' | 'cuda' | 'cpu'
  dtype: 'auto' | 'float16' | 'bfloat16' | 'float32'
  quantization: 'none' | '8bit' | '4bit'
}

export interface LLMSettings {
  provider: ProviderKind
  lmstudio: LMStudioConfig
  openai: OpenAIConfig
  transformers: TransformersConfig
  request_timeout: number
  auto_load: boolean
}

export interface GenerationSettings {
  temperature: number
  top_p: number
  max_tokens: number
  history_messages: number
  stream: boolean
}

export interface PromptSettings {
  system_template: string
  user_template: string
}

export interface GeneralSettings {
  assistant_name: string
}

export interface AppSettings {
  llm: LLMSettings
  generation: GenerationSettings
  prompt: PromptSettings
  general: GeneralSettings
}

export interface ModelInfo {
  id: string
  name: string | null
  architecture: string | null
  params: string | null
  quantization: string | null
  size_bytes: number | null
  context_length: number | null
  loaded: boolean | null
}

export interface ModelsRequest {
  provider: ProviderKind
  base_url?: string
  api_key?: string | null
  models_dir?: string
}

export interface FolderPick {
  /** The folder chosen in the system dialog, or null when it was cancelled. */
  path: string | null
}

export interface ModelsResponse {
  models: ModelInfo[]
  note: string | null
}

export interface ProviderInfo {
  kind: ProviderKind
  /** Every provider is listed. One this server cannot run comes with the reason, to show it disabled. */
  available: boolean
  reason: string | null
}

export interface LLMState {
  status: 'unloaded' | 'loading' | 'ready' | 'error'
  provider: ProviderKind | null
  model: string | null
  details: Record<string, string>
  error: string | null
  loaded_at: string | null
  load_seconds: number | null
}

export interface PromptVariable {
  name: string
  description: string
  scope: 'both' | 'user'
}

export interface PromptPreview {
  system: string
  user: string
  unknown: string[]
}

export interface AccountInfo {
  id: number
  name: string
}

export interface UserInfo {
  id: number
  username: string
  display_name: string
  role: Role
  is_superadmin: boolean
  /** Google-only users have none, so setting one asks for no current password. */
  has_password: boolean
}

export interface MemberInfo extends UserInfo {
  created_at: string
}

export interface SessionInfo {
  app: string
  /** null until someone signs in. */
  user: UserInfo | null
  account: AccountInfo | null
  /** What the signed-in user's role allows. Empty when signed out. */
  permissions: Permission[]
  /** "setup" until the instance has its first user, then whether anyone may create an account. */
  signup: 'setup' | 'open' | 'closed'
  providers: ProviderInfo[]
  /** Present when Sign in with Google is offered. */
  google_client_id: string | null
}

export interface NewUser {
  username: string
  display_name: string
  password: string
  role: AssignableRole
}

/** Only the fields that are set change. */
export interface UserUpdate {
  display_name?: string
  role?: AssignableRole
  password?: string
}

export interface AdminAccount {
  id: number
  name: string
  created_at: string
  users: MemberInfo[]
}

export interface DatabaseStatus {
  backend: string
  location: string
  fallback: boolean
  error: string | null
}

export interface Health {
  status: 'ok'
  app: string
  env: string
  database: DatabaseStatus
}

// --- Conversations and chat ----------------------------------------------------

export type MessageRole = 'user' | 'assistant'
/** How a reply ended: answered in full, cut short by the person asking, or failed (`error` says why). */
export type MessageStatus = 'complete' | 'stopped' | 'error'

export interface MessageStats {
  finish_reason: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  /** From asking to the last token. */
  seconds: number
  /** Without the wait for the first token, for a fair tokens per second. */
  generation_seconds: number | null
}

export interface MessageInfo {
  id: number
  role: MessageRole
  content: string
  /** The rest describe a reply. A question has them empty. */
  reasoning: string
  status: MessageStatus
  error: string | null
  provider: ProviderKind | null
  model: string | null
  stats: MessageStats | null
  created_at: string
}

/** A conversation as the list shows it. */
export interface ConversationInfo {
  id: number
  title: string
  created_at: string
  updated_at: string
}

export interface ConversationDetail extends ConversationInfo {
  messages: MessageInfo[]
}

/** What a reply streams as: start, then delta and reasoning as the model writes, then done. */
export type ChatEvent =
  | { type: 'start'; conversation: ConversationInfo; question: MessageInfo; provider: ProviderKind; model: string }
  | { type: 'delta'; content: string }
  | { type: 'reasoning'; content: string }
  /** reply is null only when the conversation was deleted while the reply was being written. */
  | { type: 'done'; reply: MessageInfo | null }
