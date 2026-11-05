import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { demoSnapshot } from '@/demo/snapshot'
import { useUi, type Page } from '@/store'
import { App } from '@/App'
import { PAGE_TITLE } from './Page'

const NOW = Date.UTC(2026, 10, 5, 14, 0)
const PAGES: Page[] = ['home', 'sessions', 'files', 'activity', 'approvals', 'agents']

beforeEach(() => {
  vi.stubGlobal('window', {})
  useUi.setState({ snapshot: demoSnapshot(NOW), now: NOW, link: 'up' })
})
// A server render reads the store's initial state, so make that what the window would show.
const render = (): string => {
  Object.assign(useUi.getInitialState(), useUi.getState())
  return renderToString(createElement(App))
}
afterEach(() => vi.unstubAllGlobals())

describe('every page renders demo data with the shell around it (the smoke tests click through them in Electron)', () => {
  it.each(PAGES)('%s', (page) => {
    useUi.setState({ nav: { page } })
    const main = render().split('<main')[1]!
    expect(main).toContain(`data-page="${page}"`)
    expect(main).toMatch(page === 'home' ? /<h1[^>]*>Good / : new RegExp(`<h1[^>]*>${PAGE_TITLE[page]}</h1>`))
  })
})
