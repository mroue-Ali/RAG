import type { AppSettings, LLMState, ProviderKind } from './types'

export const PROVIDERS: Record<ProviderKind, { label: string; description: string }> = {
  transformers: {
    label: 'Local',
    description: 'Runs a Hugging Face model inside the backend with transformers, on your GPU or CPU.',
  },
  lmstudio: {
    label: 'LM Studio',
    description: 'Uses the models you have downloaded in LM Studio, through its local server.',
  },
  openai: {
    label: 'OpenAI-compatible API',
    description: 'Any hosted or self-hosted endpoint that speaks the OpenAI chat API.',
  },
}

/** Providers that run on the server's own machine. Their model is loaded into memory; an API's is not. */
export function isLocal(provider: ProviderKind | null): boolean {
  return provider === 'transformers' || provider === 'lmstudio'
}

// A local model is loaded into memory. For an API nothing is loaded:
// "ready" there only means a provider and a model are filled in.
const STATUS_LABELS: Record<'local' | 'api', Record<LLMState['status'], string>> = {
  local: { ready: 'Ready', loading: 'Loading', error: 'Failed to load', unloaded: 'Not loaded' },
  api: { ready: 'Ready', loading: 'Checking', error: 'Not reachable', unloaded: 'Not set up' },
}

export function statusLabel(status: LLMState['status'], provider: ProviderKind | null): string {
  return STATUS_LABELS[isLocal(provider) ? 'local' : 'api'][status]
}

/** The model id configured for whichever provider is selected. */
export function configuredModel(settings: AppSettings): string {
  return settings.llm[settings.llm.provider].model.trim()
}
