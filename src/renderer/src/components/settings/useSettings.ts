import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSettings, SettingsPatch } from '@shared/work'
import { useUi } from '@/store'
import { applyPatch } from './patch'
import type { SectionId } from './Section'

const SAVED_MS = 2_000

/** "Error invoking remote method 'x': Error: The time must look like 18:30." → "The time must look like 18:30." */
export function plainError(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  const message = text.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '').trim()
  return message || 'AgentDeck could not save that. Try again.'
}

export interface SettingsApi {
  settings: AppSettings
  /** Saves `patch` and shows the Saved stamp on `section`; false (with the reason on the section) when it was refused. */
  save(section: SectionId, patch: SettingsPatch): Promise<boolean>
  /** Shows the Saved stamp on `section` for a moment (for changes that don't go through `save`, such as a new photo). */
  markSaved(section: SectionId): void
  savedSection: SectionId | null
  errors: Partial<Record<SectionId, string>>
  setError(section: SectionId, message: string | null): void
}

export type SettingsState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'failed'; message: string; retry(): void }
  | { kind: 'ready'; api: SettingsApi }

/** Loads the settings once, then keeps them as main last stored them. The profile in the store follows a name change. */
export function useSettings(): SettingsState {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [savedSection, setSavedSection] = useState<SectionId | null>(null)
  const [errors, setErrors] = useState<Partial<Record<SectionId, string>>>({})
  // Replies can arrive out of order when toggles are clicked quickly; only the newest one is shown.
  const latest = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const bridge = window.agentdeck

  useEffect(() => {
    if (!bridge) return
    let current = true
    bridge
      .getSettings()
      .then((s) => {
        if (!current) return
        setSettings(s)
        setFailure(null)
      })
      .catch((e: unknown) => {
        if (current) setFailure(plainError(e))
      })
    return () => {
      current = false
    }
  }, [bridge, attempt])

  useEffect(() => () => clearTimeout(timer.current), [])

  const setError = useCallback((section: SectionId, message: string | null) => {
    setErrors((prev) => {
      const rest = Object.fromEntries(Object.entries(prev).filter(([k]) => k !== section))
      return message ? { ...rest, [section]: message } : rest
    })
  }, [])

  const markSaved = useCallback((section: SectionId) => {
    setSavedSection(section)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setSavedSection(null), SAVED_MS)
  }, [])

  const save = useCallback(
    async (section: SectionId, patch: SettingsPatch): Promise<boolean> => {
      if (!bridge) return false
      const n = ++latest.current
      // The switch moves at once; main's reply confirms it (or, when it refuses, the stored values come back).
      setSettings((prev) => (prev ? applyPatch(prev, patch) : prev))
      try {
        const next = await bridge.updateSettings(patch)
        if (n === latest.current) setSettings(next)
      } catch (e) {
        setError(section, plainError(e))
        await bridge.getSettings().then(setSettings, () => undefined)
        return false
      }
      setError(section, null)
      markSaved(section)
      if (patch.profileName !== undefined) {
        // The sidebar and the greeting show the name main stored, which may differ from what was typed (trimmed, or the default).
        await bridge.getProfile().then(useUi.getState().setProfile, () => undefined)
      }
      return true
    },
    [bridge, markSaved, setError]
  )

  if (!bridge) return { kind: 'unavailable' }
  if (settings) return { kind: 'ready', api: { settings, save, markSaved, savedSection, errors, setError } }
  if (failure) {
    return {
      kind: 'failed',
      message: failure,
      retry: () => {
        setFailure(null)
        setAttempt((a) => a + 1)
      }
    }
  }
  return { kind: 'loading' }
}
