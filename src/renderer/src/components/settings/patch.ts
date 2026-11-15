import type { AppSettings, NotificationSettings, SettingsPatch } from '@shared/work'
import type { AttentionKind } from '@shared/snapshot'

/**
 * `patch` applied to `s` as main will store it, so a switch can move at once and main's reply only confirms it. The name is
 * left out: main trims it and may swap in the default, so the field shows what main answers.
 */
export function applyPatch(s: AppSettings, patch: SettingsPatch): AppSettings {
  const n = patch.notifications
  return {
    ...s,
    eod: { ...s.eod, ...patch.eod },
    notifications: { ...s.notifications, ...n, kinds: { ...s.notifications.kinds, ...n?.kinds } },
    startAtLogin: patch.startAtLogin ?? s.startAtLogin,
    startMinimized: patch.startMinimized ?? s.startMinimized,
    usage: { ...s.usage, ...patch.usage }
  }
}

/**
 * One kind, for a notifications patch. Main merges kinds one by one, so sending only the one that changed means two quick
 * clicks on different switches can't undo each other (the shared type asks for all five, which main does not need).
 */
export const kindOnly = (kind: AttentionKind, on: boolean): NotificationSettings['kinds'] => ({ [kind]: on }) as NotificationSettings['kinds']
