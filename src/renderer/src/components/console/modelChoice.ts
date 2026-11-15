import { MODEL_PATTERN } from '@shared/console'

/** The model chosen last, for the Console and the Composer alike (a per-viewer convenience: it works without storage). */
const KEY = 'agentdeck.console.model'

export function readModel(): string | null {
  try {
    const saved = localStorage.getItem(KEY)
    return saved && MODEL_PATTERN.test(saved) ? saved : null
  } catch {
    return null
  }
}

export function saveModel(model: string | null): void {
  try {
    if (model === null) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, model)
  } catch {
    // nothing to keep it in; the choice still applies to what is open
  }
}
