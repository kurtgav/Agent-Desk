import { describe, expect, it, vi } from 'vitest'
import type { ClaudeLink } from '@shared/work'
import { createLinkReader, type LinkDeps } from './claude'

const USAGE: ClaudeLink['usage'] = { enabled: true, receiving: false, readLogs: false }

function deps(over: Partial<LinkDeps> = {}): LinkDeps & { clock: { now: number } } {
  const clock = { now: 1_000 }
  return {
    clock,
    now: () => clock.now,
    cli: vi.fn(() => Promise.resolve('C:\\bin\\claude.exe')),
    version: vi.fn(() => Promise.resolve('2.1.323')),
    auth: vi.fn(() => Promise.resolve({ signIn: 'subscription' as const, plan: 'Max' })),
    usage: vi.fn(() => Promise.resolve(USAGE)),
    ...over
  }
}

describe('the Claude Code link', () => {
  it('puts the CLI, how it is signed in and the telemetry state together', async () => {
    expect(await createLinkReader(deps()).read()).toEqual({
      cli: { found: true, path: 'C:\\bin\\claude.exe', version: '2.1.323' },
      signIn: 'subscription',
      plan: 'Max',
      usage: USAGE
    })
  })

  it('says unknown, and asks the CLI nothing, when there is no CLI', async () => {
    const d = deps({ cli: () => Promise.resolve(null) })
    expect(await createLinkReader(d).read()).toEqual({ cli: { found: false, path: null, version: null }, signIn: 'unknown', plan: null, usage: USAGE })
    expect(d.version).not.toHaveBeenCalled()
    expect(d.auth).not.toHaveBeenCalled()
  })

  it('never throws: a probe that fails leaves "unknown", and the rest still answers', async () => {
    const link = await createLinkReader(
      deps({ version: () => Promise.reject(new Error('boom')), auth: () => Promise.reject(new Error('boom')), usage: () => Promise.reject(new Error('boom')) })
    ).read()
    expect(link).toMatchObject({ cli: { found: true, version: null }, signIn: 'unknown', plan: null, usage: { enabled: false, receiving: false } })
    await expect(createLinkReader(deps({ cli: () => Promise.reject(new Error('boom')) })).read()).resolves.toMatchObject({ cli: { found: false } })
  })

  it('answers from the last probe for a few seconds, then asks again', async () => {
    const d = deps()
    const reader = createLinkReader(d)
    await reader.read()
    d.clock.now += 4_000
    await reader.read()
    expect(d.auth).toHaveBeenCalledTimes(1)
    d.clock.now += 2_000
    await reader.read()
    expect(d.auth).toHaveBeenCalledTimes(2)
  })

  it('shares one probe between callers that ask together', async () => {
    const d = deps()
    const reader = createLinkReader(d)
    await Promise.all([reader.read(), reader.read(), reader.read()])
    expect(d.cli).toHaveBeenCalledTimes(1)
    expect(d.auth).toHaveBeenCalledTimes(1)
  })

  it('asks again at once after a change of settings (invalidate)', async () => {
    const d = deps()
    const reader = createLinkReader(d)
    await reader.read()
    reader.invalidate()
    await reader.read()
    expect(d.usage).toHaveBeenCalledTimes(2)
  })
})
