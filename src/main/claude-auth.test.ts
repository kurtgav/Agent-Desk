import { describe, expect, it } from 'vitest'
import { parseAuth } from './claude-auth'

// The shape `claude auth status` prints in 2.1.323 (this machine). The identity fields hold made-up values here, so the
// tests can prove none of them comes back out.
const IDENTITY = { email: 'person@example.com', orgId: '00000000-0000-4000-8000-000000000000', orgName: "Person's Organization" }
const status = (over: Record<string, unknown>): string =>
  JSON.stringify({
    loggedIn: true,
    authMethod: 'claude.ai',
    apiProvider: 'firstParty',
    analyticsDisabled: false,
    projectsDirectory: '~/.claude/projects',
    configDirectory: '~/.claude',
    loginExpiresAt: '2026-12-01T00:00:00.000Z',
    ...IDENTITY,
    subscriptionType: 'max',
    storedClaudeAiLogin: true,
    planTier: 'max_20x',
    ...over
  })

describe('parseAuth', () => {
  it('reads a subscription and its plan', () => {
    expect(parseAuth(status({}))).toEqual({ signIn: 'subscription', plan: 'Max 20x' })
    expect(parseAuth(status({ planTier: 'max_5x' }))).toEqual({ signIn: 'subscription', plan: 'Max 5x' })
    expect(parseAuth(status({ planTier: undefined, subscriptionType: 'pro' }))).toEqual({ signIn: 'subscription', plan: 'Pro' })
    expect(parseAuth(status({ planTier: undefined, subscriptionType: 'ultra' }))).toEqual({ signIn: 'subscription', plan: 'Ultra' })
    expect(parseAuth(status({ planTier: 'ultra', subscriptionType: 'Ultra' }))).toEqual({ signIn: 'subscription', plan: 'Ultra' })
    expect(parseAuth(status({ planTier: undefined, subscriptionType: 'mega' }))).toEqual({ signIn: 'subscription', plan: null })
  })

  it('returns no email, organisation, id, path or date: only a method and a plan word', () => {
    const out = JSON.stringify(parseAuth(status({})))
    for (const secret of [IDENTITY.email, IDENTITY.orgId, IDENTITY.orgName, 'example.com', '.claude', '2026-12-01']) expect(out).not.toContain(secret)
    expect(Object.keys(parseAuth(status({}))).sort()).toEqual(['plan', 'signIn'])
  })

  it('shows a plan only when it is a word the CLI is known to use', () => {
    expect(parseAuth(status({ planTier: 'person@example.com', subscriptionType: 'Person@Example.com' }))).toEqual({ signIn: 'subscription', plan: null })
  })

  it('reads signed out (the body is read whatever the exit code)', () => {
    expect(parseAuth(JSON.stringify({ loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' }))).toEqual({ signIn: 'signed-out', plan: null })
  })

  it('reads an API key', () => {
    expect(parseAuth(JSON.stringify({ loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty' }))).toEqual({ signIn: 'api-key', plan: null })
    expect(parseAuth(JSON.stringify({ loggedIn: true, authMethod: 'console', apiProvider: 'firstParty', ...IDENTITY }))).toEqual({ signIn: 'api-key', plan: null })
  })

  it('does not guess for a cloud provider, a method it has not seen, or output it cannot read', () => {
    const unknown = { signIn: 'unknown', plan: null }
    expect(parseAuth(status({ apiProvider: 'bedrock' }))).toEqual(unknown)
    expect(parseAuth(status({ authMethod: 'something-new' }))).toEqual(unknown)
    expect(parseAuth(JSON.stringify({ authMethod: 'claude.ai' }))).toEqual(unknown)
    expect(parseAuth("error: unknown command 'auth'")).toEqual(unknown)
    expect(parseAuth('')).toEqual(unknown)
    expect(parseAuth('[]')).toEqual(unknown)
    expect(parseAuth('null')).toEqual(unknown)
  })
})
