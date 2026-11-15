import { create } from 'zustand'
import type { ModelInfo, ModelListResult } from '@shared/console'
import { useUi } from '@/store'
import { demoModels } from './demo'

/**
 * The models Claude Code offers this account (main asks it once, console-models.ts), so the picker lists exactly what Claude Code's
 * own picker does. Asked once per run; until it answers, or when it cannot, the picker falls back to the aliases.
 */

interface ModelsState {
  list: ModelInfo[] | null
  state: 'idle' | 'loading' | 'done' | 'failed'
  /** Why the last read failed, in words for the person. */
  error: string | null
}

export const useModels = create<ModelsState>(() => ({ list: null, state: 'idle', error: null }))

const demo = (): boolean => useUi.getState().snapshot.mode === 'demo' || !window.agentdeck

export async function loadModels(): Promise<void> {
  const { state } = useModels.getState()
  if (state === 'loading' || state === 'done') return
  useModels.setState({ state: 'loading', error: null })
  const r: ModelListResult = demo()
    ? { ok: true, models: demoModels(), at: Date.now() }
    : await window.agentdeck!.consoleModels().catch((): ModelListResult => ({ ok: false, error: 'AgentDeck could not reach its main process.' }))
  useModels.setState(r.ok ? { list: r.models, state: 'done', error: null } : { state: 'failed', error: r.error })
}

export const resetModels = (): void => useModels.setState({ list: null, state: 'idle', error: null })
