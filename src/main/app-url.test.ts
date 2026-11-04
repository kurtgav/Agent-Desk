import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { APP_ENTRY, isAppUrl, resolveInside } from './app-url'

const ROOT = resolve('out/renderer')

describe('resolveInside', () => {
  test('maps a URL path to a file under the root', () => {
    expect(resolveInside(ROOT, '/index.html')).toBe(join(ROOT, 'index.html'))
    expect(resolveInside(ROOT, '/assets/index-abc.js')).toBe(join(ROOT, 'assets', 'index-abc.js'))
    expect(resolveInside(ROOT, '/assets/my%20font.woff2')).toBe(join(ROOT, 'assets', 'my font.woff2'))
  })

  test.each([
    ['plain dot-dot', '/../package.json'],
    ['encoded dot-dot', '/%2e%2e/package.json'],
    ['encoded slash', '/..%2F..%2Fpackage.json'],
    ['encoded backslash', '/..%5C..%5Cpackage.json'],
    ['drive-absolute', '/C:/Windows/win.ini'],
    ['encoded drive-absolute', '/C%3A%5CWindows%5Cwin.ini'],
    ['null byte', '/index.html%00.png'],
    ['malformed escape', '/%E0%A4%A'],
    ['the root itself', '/']
  ])('rejects %s', (_label, path) => {
    expect(resolveInside(ROOT, path)).toBeNull()
  })

  test('allows names that merely start with two dots', () => {
    expect(resolveInside(ROOT, '/..hidden')).toBe(join(ROOT, '..hidden'))
  })
})

describe('isAppUrl', () => {
  test('accepts our own origin', () => {
    expect(isAppUrl(APP_ENTRY)).toBe(true)
    expect(isAppUrl('app://agentdeck/settings#x')).toBe(true)
  })

  test.each(['app://evil/index.html', 'https://example.com/', 'file:///C:/Windows/win.ini', 'not a url', 'javascript:alert(1)'])(
    'rejects %s',
    (url) => {
      expect(isAppUrl(url)).toBe(false)
    }
  )

  test('accepts the dev server origin only when one is given', () => {
    expect(isAppUrl('http://localhost:5173/index.html', 'http://localhost:5173')).toBe(true)
    expect(isAppUrl('http://localhost:5174/', 'http://localhost:5173')).toBe(false)
    expect(isAppUrl('http://localhost:5173/')).toBe(false)
  })
})
