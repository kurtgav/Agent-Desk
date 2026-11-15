import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '@/App'
import { demoSnapshot } from '@/demo/snapshot'
import { useUi } from '@/store'
import { commands, search } from '../Palette'
import { connectConsole, resetConsole, selectView, useConsole } from './store'

const NOW = Date.UTC(2026, 10, 5, 14, 0)

beforeEach(() => {
  vi.stubGlobal('window', {})
  useUi.setState({ snapshot: demoSnapshot(NOW), now: NOW, link: 'up', nav: { page: 'console' } })
  resetConsole()
})
afterEach(() => vi.unstubAllGlobals())

// A server render reads the stores' initial state, so make that what the window would show.
const render = (): string => {
  Object.assign(useUi.getInitialState(), useUi.getState())
  Object.assign(useConsole.getInitialState(), useConsole.getState())
  return renderToString(createElement(App))
}
const main = (html: string): string => html.split('<main')[1]!

describe('the Console page (demo data, the shell around it)', () => {
  it('shows the open conversation as a live log, with its tool cards and turn footers', () => {
    connectConsole()
    const html = main(render())
    expect(html).toContain('data-page="console"')
    expect(html).toMatch(/<h1[^>]*>Console<\/h1>/)
    expect(html).toContain('role="log"')
    expect(html).toContain('aria-label="Conversation with Claude Code"')
    expect(html).toContain('Stream the invoice export instead of building the whole file in memory')
    expect(html.match(/>Run:<\/span>/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(html).toContain('Failed')
    expect(html).toMatch(/54 s/)
    expect(html).toContain('aria-label="Conversations"')
    expect(html).toContain('Resume a session')
    expect(html).not.toContain('dangerouslySetInnerHTML')
  })

  it('shows the new-conversation view with its starters when nothing is open', () => {
    connectConsole()
    selectView(null)
    const html = main(render())
    expect(html).toContain('What should Claude work on?')
    expect(html).toContain('Explain this project')
    expect(html).toContain('Ask first')
    expect(html).toContain('aria-label="Project: ')
  })

  it('is in the palette as New conversation', () => {
    const entry = search(commands(), 'new conversation').find((c) => c.id === 'new-conversation')
    expect(entry).toMatchObject({ group: 'Actions', label: 'New conversation' })
  })
})
