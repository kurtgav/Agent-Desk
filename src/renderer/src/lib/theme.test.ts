import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { THEME_STORAGE_KEY } from '@shared/theme'
import { paintTheme, readStoredChoice, writeStoredChoice } from './theme'

/** An in-memory stand-in for localStorage. */
function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data }
}

describe('the localStorage mirror', () => {
  it('round-trips the three choices under the key the boot script reads', () => {
    const store = memoryStore()
    for (const choice of ['light', 'dark', 'system'] as const) {
      writeStoredChoice(choice, store)
      expect(store.data.get(THEME_STORAGE_KEY)).toBe(choice)
      expect(readStoredChoice(store)).toBe(choice)
    }
  })

  it('reads nothing when the value is missing or not a choice', () => {
    expect(readStoredChoice(memoryStore())).toBeNull()
    expect(readStoredChoice(memoryStore({ [THEME_STORAGE_KEY]: 'sepia' }))).toBeNull()
  })

  it('survives storage that is blocked, throws, or is not there at all', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      }
    }
    expect(readStoredChoice(blocked)).toBeNull()
    expect(() => writeStoredChoice('dark', blocked)).not.toThrow()
    expect(readStoredChoice(null)).toBeNull()
    expect(() => writeStoredChoice('dark', null)).not.toThrow()
  })
})

describe('paintTheme', () => {
  const root = (theme?: string) => ({
    dataset: { theme } as { theme?: string },
    style: { colorScheme: '' },
    classList: { add: vi.fn(), remove: vi.fn() }
  })

  it('sets data-theme and color-scheme together', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => cb())
    const r = root('light')
    paintTheme('dark', r as unknown as HTMLElement)
    expect(r.dataset.theme).toBe('dark')
    expect(r.style.colorScheme).toBe('dark')
    // A change repaints in one frame: the switching class goes on and comes off again.
    expect(r.classList.add).toHaveBeenCalledWith('theme-switching')
    expect(r.classList.remove).toHaveBeenCalledWith('theme-switching')
    vi.unstubAllGlobals()
  })

  it('does nothing when the page already shows that theme, or when there is no page', () => {
    const r = root('dark')
    paintTheme('dark', r as unknown as HTMLElement)
    expect(r.classList.add).not.toHaveBeenCalled()
    expect(() => paintTheme('dark', null)).not.toThrow()
  })
})

describe('public/theme-boot.js', () => {
  const script = readFileSync(resolve('src/renderer/public/theme-boot.js'), 'utf8')

  /** Runs the script the way the page does, against a fake window, and returns what it wrote on <html>. */
  function boot(opts: { stored?: string | null; osDark: boolean; storageThrows?: boolean }): { theme?: string; scheme?: string } {
    const html = { dataset: {} as { theme?: string }, style: {} as { colorScheme?: string } }
    runInNewContext(script, {
      localStorage: {
        getItem: () => {
          if (opts.storageThrows) throw new Error('blocked')
          return opts.stored ?? null
        }
      },
      window: { matchMedia: () => ({ matches: opts.osDark }) },
      document: { documentElement: html }
    })
    return { theme: html.dataset.theme, scheme: html.style.colorScheme }
  }

  it('an explicit choice beats the OS, in both directions', () => {
    expect(boot({ stored: 'dark', osDark: false })).toEqual({ theme: 'dark', scheme: 'dark' })
    expect(boot({ stored: 'light', osDark: true })).toEqual({ theme: 'light', scheme: 'light' })
  })

  it('system, nothing stored, or a stray value follows the OS', () => {
    expect(boot({ stored: 'system', osDark: true }).theme).toBe('dark')
    expect(boot({ stored: null, osDark: false }).theme).toBe('light')
    expect(boot({ stored: 'sepia', osDark: true }).theme).toBe('dark')
  })

  it('blocked storage still gets a theme, from the OS', () => {
    expect(boot({ storageThrows: true, osDark: true }).theme).toBe('dark')
  })

  it('agrees with the TypeScript side on the key', () => {
    expect(script).toContain(`'${THEME_STORAGE_KEY}'`)
  })
})

describe('index.html', () => {
  const html = readFileSync(resolve('src/renderer/index.html'), 'utf8')

  it('loads the boot script from a file, in <head>, before the app', () => {
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'))
    expect(head).toContain('<script src="/theme-boot.js"></script>')
    expect(html.indexOf('/theme-boot.js')).toBeLessThan(html.indexOf('type="module"'))
  })

  it('has no inline script (script-src is self)', () => {
    expect(html).toContain("script-src 'self';")
    for (const tag of html.match(/<script\b[^>]*>/g) ?? []) expect(tag).toMatch(/\ssrc="/)
  })
})
