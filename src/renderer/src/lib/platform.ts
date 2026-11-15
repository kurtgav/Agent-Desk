/**
 * main's `process.platform` (AppInfo) on `<html data-platform>`: styles.css keeps the sidebar's top-left corner clear for
 * macOS's traffic lights, and the session menu names the system's file manager.
 */
const root = (): HTMLElement | null => (typeof document === 'undefined' ? null : document.documentElement)

export function markPlatform(platform: string, el: HTMLElement | null = root()): void {
  if (el) el.dataset.platform = platform
}

export const isMac = (el: HTMLElement | null = root()): boolean => el?.dataset.platform === 'darwin'
