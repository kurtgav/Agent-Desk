import { describe, expect, it } from 'vitest'
import { isMac, markPlatform } from './platform'

const html = (): HTMLElement => ({ dataset: {} }) as unknown as HTMLElement

describe('data-platform', () => {
  it('puts the platform main reports on <html>, which the macOS styles and labels key off', () => {
    const el = html()
    markPlatform('darwin', el)
    expect(el.dataset.platform).toBe('darwin')
    expect(isMac(el)).toBe(true)
    markPlatform('win32', el)
    expect(isMac(el)).toBe(false)
  })

  it('is not macOS before main has said, or without a document (tests, demo screenshots)', () => {
    expect(isMac(html())).toBe(false)
    expect(isMac()).toBe(false)
    expect(() => markPlatform('darwin')).not.toThrow()
  })
})
