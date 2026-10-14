import { configuredModel } from '../lib/providers'
import type { LLMState, ProviderKind } from '../lib/types'
import { useModel, useSettings } from './contexts'

export interface ModelSummary {
  status: LLMState['status']
  /** The model that is loaded or loading, otherwise the one saved in settings. Empty if neither. */
  model: string
  provider: ProviderKind | null
  /** Settings name a model, so there is something to load. */
  configured: boolean
}

/** What to show wherever the app talks about "the model", loaded or not. */
export function useModelSummary(): ModelSummary {
  const { state } = useModel()
  const { saved } = useSettings()
  const status = state?.status ?? 'unloaded'
  const active = status !== 'unloaded' ? state : null
  const configured = saved ? configuredModel(saved) : ''
  return {
    status,
    model: active?.model ?? configured,
    provider: active?.provider ?? saved?.llm.provider ?? null,
    configured: configured !== '',
  }
}
