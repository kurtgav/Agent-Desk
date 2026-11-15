import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { NOT_KNOWN } from '../src/main/dispatch'
import { NO_OPTIONS, type ConsoleStart } from '../src/shared/console'
import { bridge, cleanup, closeApps, collectorReady, launch, playSession, profile, rawBridge } from './support'

// The Console against the REAL main process, collector and renderer, with test/fixtures/fake-claude.mjs standing in for
// `claude` (set as Settings' claudePath override, so the real resolution and the real spawn path run). No model, no account.
// NOT RUN YET (the agent that wrote this was told not to start Electron): follow work-live-ui.spec.ts if a selector drifts.

test.afterEach(cleanup)

const FAKE = resolve('test/fixtures/fake-claude.cmd')
const FAKE_SESSION = '11111111-2222-4333-8444-555555555555'

const log = (page: Page) => page.getByRole('log', { name: 'Conversation with Claude Code' })
const goToConsole = async (page: Page): Promise<void> => {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Console/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Console')
}
/** The composer is one textarea; its label says which kind of message it takes. */
const composer = (page: Page, fresh: boolean) => page.getByLabel(fresh ? 'First message for a new conversation' : 'Message for Claude Code')
const say = async (page: Page, fresh: boolean, text: string): Promise<void> => {
  await composer(page, fresh).fill(text)
  await composer(page, fresh).press('Enter')
}
// The fake writes its log when it first runs, so before that there is no file: an empty log, not an error.
const fakeLog = (path: string): string[] => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : [])
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Live mode with the fake as `claude`, and one session the collector has seen in a real folder (the Composer's "known folder" rule). */
async function live(prefix: string, env: Record<string, string> = {}, seed?: (userData: string) => void) {
  const userData = profile(prefix)
  const folder = profile(`${prefix}-project`)
  writeFileSync(join(userData, 'config.json'), JSON.stringify({ claudePath: FAKE }))
  seed?.(userData)
  const logFile = join(userData, 'fake-claude.log')
  const { page, errors } = await launch(userData, { env: { FAKE_CLAUDE_LOG: logFile, ...env } })
  await expect(page.getByTestId('home')).toBeVisible()
  const endpoint = await collectorReady(userData)
  await playSession(endpoint, 1, 'console-seed', folder)
  await expect.poll(async () => (await bridge(page, 'getSnapshot'))?.sessions.length, { timeout: 10_000 }).toBe(1)
  await goToConsole(page)
  return { page, errors, logFile, folder, userData }
}

test('a conversation: it starts, streams, shows a tool, takes a follow-up, stops a slow turn, ends and resumes', async () => {
  const { page, logFile, errors } = await live('console-flow')
  const thread = log(page)

  // The new-conversation view first: starters, and the composer focused.
  await expect(page.getByRole('heading', { name: 'What should Claude work on?' })).toBeVisible()
  await expect(composer(page, true)).toBeFocused()

  // Start: the reply streams in, the footer closes the turn, the rail and header know it.
  await say(page, true, 'Hello from the spec')
  await expect(thread).toContainText('Hello from the spec')
  await expect(thread).toContainText('Fake reply to: Hello from the spec')
  await expect(page.getByRole('heading', { level: 2, name: 'Hello from the spec' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Conversations' }).getByText('Your turn')).toBeVisible()
  await expect(thread).toContainText(/\d+(\.\d)? s · .* in · .* out/)

  // The prompt went through stdin, never the command line; the mode is always given.
  const argv = fakeLog(logFile).find((l) => l.startsWith('ARGV '))!
  expect(argv).not.toContain('Hello from the spec')
  expect(argv).toContain('"--permission-mode","default"')
  expect(argv).toContain('"--input-format","stream-json"')

  // A tool call is a card: one line, a status, the input and result one click away.
  await say(page, false, 'use a tool please')
  const card = thread.getByRole('button', { name: /Find files: scripts/ })
  await expect(card).toBeVisible()
  await card.click()
  await expect(thread).toContainText('scripts\\a.mjs')
  await expect(thread).toContainText('Two files in scripts')

  // A tool nobody approved says why, and what to do.
  await say(page, false, 'denied please')
  await expect(thread.getByText('Not allowed')).toBeVisible()
  await expect(thread.getByRole('button', { name: 'Remote approvals…' })).toBeVisible()
  await expect(thread.getByRole('button', { name: /Run: npm test/ })).toBeVisible()

  // A slow turn is stopped with Esc: the turn says Stopped, and the conversation waits for the next message.
  await say(page, false, 'go slow please')
  await expect(thread).toContainText('Working on it slowly.')
  await composer(page, false).press('Escape')
  await expect(thread.getByText('Stopped', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Conversation' }).getByText('Your turn')).toBeVisible()

  // End it: the session stays resumable.
  await page.getByRole('button', { name: 'End conversation' }).click()
  await expect(page.getByRole('region', { name: 'Conversation' }).getByText('Ended', { exact: true })).toBeVisible()
  await expect(page.getByText('This conversation is over. Resume it to keep going.')).toBeVisible()

  // Resume: the next message starts a new process with --resume and the same folder.
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await expect(page.getByText('Continuing')).toBeVisible()
  await say(page, true, 'carry on')
  await expect(thread).toContainText('Fake reply to: carry on')
  const resumed = fakeLog(logFile).filter((l) => l.startsWith('ARGV ')).at(-1)!
  expect(resumed).toContain(`"--resume","${FAKE_SESSION}"`)
  await expect(page.getByRole('complementary', { name: 'Conversations' }).getByRole('listitem')).toHaveCount(2)

  // Ctrl+N starts another one from anywhere on the page.
  await page.keyboard.press('Control+n')
  await expect(page.getByRole('heading', { level: 2, name: 'New conversation' })).toBeVisible()
  await expect(composer(page, true)).toBeFocused()
  expect(errors).toEqual([])
})

test('models, capabilities, the / menu and allowing an MCP tool, live', async () => {
  const { page, logFile, errors } = await live('console-caps')
  const thread = log(page)
  const sent = (): string[] => fakeLog(logFile).filter((l) => l.startsWith('IN '))

  // Before any conversation there is nothing to list, and the / menu says how to get it (a status, not an empty box).
  await page.getByRole('button', { name: /^Capabilities/ }).click()
  await expect(page.getByText('Nothing is loaded yet')).toBeVisible()
  await page.keyboard.press('Escape')
  await composer(page, true).fill('/')
  await expect(page.getByRole('status').filter({ hasText: 'Start the conversation to load them' }).first()).toBeVisible()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await composer(page, true).fill('')

  // A model: an alias, then any full id (the long-context suffix too), then back to an alias for the conversation.
  await page.getByRole('button', { name: /^Model: Default/ }).click()
  await page.getByLabel('Custom model').fill('claude-opus-4-5[1m]')
  await page.getByRole('button', { name: 'Use', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Model: claude-opus-4-5\[1m\]/ })).toBeVisible()
  await page.getByRole('button', { name: /^Model: / }).click()
  await page.getByLabel('Custom model').fill('--bad model')
  await expect(page.getByText('Use letters, digits')).toBeVisible()
  await page.getByRole('radio', { name: /^Sonnet/ }).click()
  await expect(page.getByRole('button', { name: /^Model: Sonnet/ })).toBeVisible()

  // Start: the model asked for goes to the command line as one argument; the header names the one in use.
  await say(page, true, 'Hello caps')
  await expect(thread).toContainText('Fake reply to: Hello caps')
  const argv = JSON.parse(fakeLog(logFile).find((l) => l.startsWith('ARGV '))!.slice(5)) as string[]
  expect(argv.slice(argv.indexOf('--model'), argv.indexOf('--model') + 2)).toEqual(['--model', 'sonnet'])
  await expect(page.getByRole('region', { name: 'Conversation' })).toContainText('claude-fake-sonnet')

  // Capabilities: grouped, counted, searchable, with a sentence of help and the failures in plain words.
  await page.getByRole('button', { name: /^Capabilities/ }).click()
  const caps = page.getByRole('dialog', { name: 'What Claude can use here' })
  await expect(caps).toContainText('Model in use: claude-fake-sonnet')
  await expect(caps).toContainText('MCP servers connect Claude to other apps')
  await expect(caps.getByText('broken')).toBeVisible()
  await expect(caps).toContainText('claude mcp add')
  await caps.getByRole('tab', { name: /^skills/i }).click()
  await caps.getByLabel('Search what Claude can use').fill('side')
  await expect(caps.getByText('/aside')).toBeVisible()
  await expect(caps.getByText('/caveman:caveman-help')).toHaveCount(0)
  await page.keyboard.press('Escape')

  // The / menu: a combobox with a listbox; arrows move, Tab or Enter chooses, Esc closes without stopping anything.
  const box = composer(page, false)
  await expect(box).toHaveRole('combobox')
  await box.fill('/as')
  await expect(page.getByRole('listbox', { name: 'Commands and skills' })).toBeVisible()
  await expect(page.getByRole('option', { name: /\/aside/ })).toHaveAttribute('aria-selected', 'true')
  await expect(box).toHaveAttribute('aria-expanded', 'true')
  await box.press('Escape')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  // Esc holds for that word only: clear the box and type it again, and the menu is back.
  await box.fill('')
  await box.fill('/as')
  await expect(page.getByRole('listbox', { name: 'Commands and skills' })).toBeVisible()
  await box.press('Tab')
  await expect(box).toHaveValue('/aside ')
  await box.pressSequentially('what is 2+2')
  await box.press('Enter')
  await expect(thread).toContainText('Skill ran: /aside what is 2+2')
  // The text went through as the user's own message, unchanged: that is how Claude Code runs a skill in -p.
  expect(sent().some((l) => l.includes('"/aside what is 2+2"'))).toBe(true)

  // An MCP tool that was not allowed: the card names the server and tool, and the fix is one click, no restart.
  await say(page, false, 'call the mcp server')
  await expect(thread.getByRole('button', { name: /fake server · ping/ })).toBeVisible()
  await thread.getByRole('button', { name: /^Allow fake server · ping for this conversation/ }).click()
  await expect(thread.getByText('fake server · ping is allowed for this conversation')).toBeVisible()
  await expect.poll(() => sent().some((l) => l.includes('apply_flag_settings') && l.includes('mcp__fake_server__ping'))).toBe(true)
  await say(page, false, 'call the mcp server again')
  await expect(thread).toContainText('The server answered: pong.')
  await expect(page.getByRole('region', { name: 'Conversation' })).toContainText('1 allowed tool')
  expect(errors).toEqual([])
})

test('Advanced options reach the command line as arguments, and main refuses what is not valid', async () => {
  const { page, folder, logFile, errors } = await live('console-advanced', { FAKE_MCP_LIST: 'normal' })
  const ok: ConsoleStart = { cwd: folder, prompt: 'x', model: null, effort: 'low', permissionMode: 'default', resume: null, options: NO_OPTIONS }

  // The new-conversation form: collapsed, then a rule is checked as it is typed.
  const advanced = page.getByRole('button', { name: /^Advanced/ })
  await expect(advanced).toHaveAttribute('aria-expanded', 'false')
  await advanced.click()
  await page.locator('#adv-allowed').fill('Bash(rm -rf /); echo')
  await page.getByRole('button', { name: 'Add to allowed tools' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'not a tool rule' })).toBeVisible()
  await page.locator('#adv-allowed').fill('mcp__fake_server__ping')
  await page.getByRole('button', { name: 'Add to allowed tools' }).click()
  await page.locator('#adv-append').fill('Answer in French.')
  await say(page, true, 'Hello advanced')
  await expect(log(page)).toContainText('Fake reply to: Hello advanced')
  const argv = JSON.parse(fakeLog(logFile).find((l) => l.startsWith('ARGV '))!.slice(5)) as string[]
  expect(argv).not.toContain('--dangerously-skip-permissions')
  expect(argv.slice(argv.indexOf('--allowedTools'), argv.indexOf('--allowedTools') + 2)).toEqual(['--allowedTools', 'mcp__fake_server__ping'])
  expect(argv.slice(argv.indexOf('--append-system-prompt'), argv.indexOf('--append-system-prompt') + 2)).toEqual(['--append-system-prompt', 'Answer in French.'])
  await expect(page.getByRole('region', { name: 'Conversation' })).toContainText('Custom instructions')
  await expect(page.getByRole('region', { name: 'Conversation' })).toContainText('1 allowed tool')

  // Main checks every option itself, whatever the page sent.
  for (const options of [
    { ...NO_OPTIONS, allowedTools: ['Bash(x); calc'] }, { ...NO_OPTIONS, allowedTools: Array.from({ length: 21 }, (_, i) => `Read${i}`) },
    { ...NO_OPTIONS, disallowedTools: ['--help'] }, { ...NO_OPTIONS, addDirs: ['C:\\Windows'] }, { ...NO_OPTIONS, appendSystemPrompt: 'x'.repeat(2_001) },
    { ...NO_OPTIONS, maxBudgetUsd: 1_000_000 }, { ...NO_OPTIONS, fallbackModel: '--x' }, { ...NO_OPTIONS, maxTurns: 3 }, { ...NO_OPTIONS, mcpConfig: 'x.json' }
  ]) {
    expect(await rawBridge(page, 'consoleStart', { ...ok, options }), JSON.stringify(options).slice(0, 80)).toMatchObject({ ok: false })
  }
  expect(await rawBridge(page, 'consoleStart', { ...ok, model: 'claude-opus-4-5[1m]' })).toMatchObject({ ok: true })
  expect(await rawBridge(page, 'consoleAllow', 'c_00000000', 'mcp__a__b')).toMatchObject({ ok: false })
  expect(await rawBridge(page, 'consoleAllow', '../x', 'Read')).toMatchObject({ ok: false })
  const list = await rawBridge(page, 'consoleList')
  const live1 = (list as { id: string }[])[0]!.id
  for (const rule of ['Bash(x); y', '--help', '', 'a'.repeat(300)]) expect(await rawBridge(page, 'consoleAllow', live1, rule), rule).toMatchObject({ ok: false })
  expect(await rawBridge(page, 'consoleMcpList', 'C:\\Windows')).toMatchObject({ ok: false })
  expect(errors).toEqual([])
})

test('the MCP check shows names and status only, never what the list also carries', async () => {
  const { page, errors } = await live('console-mcp', { FAKE_MCP_LIST: 'normal' })

  await page.getByRole('button', { name: /^Capabilities/ }).click()
  const caps = page.getByRole('dialog', { name: 'What Claude can use here' })
  await caps.getByRole('button', { name: 'Check now' }).click()
  await expect(caps.getByText('Checked just now')).toBeVisible()
  for (const name of ['claude.ai Figma', 'plugin:expo:expo', 'github', 'caveman']) await expect(caps.getByText(name, { exact: true })).toBeVisible()
  await expect(caps.getByText('Needs sign-in').first()).toBeVisible()
  // The fake's list carries a token in a URL, a token and a password on command lines: none of it reaches the page.
  const text = await page.locator('body').innerText()
  for (const secret of ['SECRETSECRET', 'ghp_', 'hunter2', 'sk-ant', 'mcp.example.com', 'someone']) expect(text, secret).not.toContain(secret)
  expect(errors).toEqual([])
})

test('a fork: --fork-session after --resume, titled and marked as a copy, and a later Resume continues the copy', async () => {
  const { page, folder, logFile, errors } = await live('console-fork')
  const original = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  const copy = '77777777-6666-4555-8444-333333333333'
  const start = { cwd: folder, prompt: 'try the other approach', model: null, effort: 'low', permissionMode: 'default', resume: original, options: NO_OPTIONS } as const

  // A fork without a session to copy is refused in words, before anything starts.
  expect(await rawBridge(page, 'consoleStart', { ...start, resume: null, fork: true })).toEqual({ ok: false, error: 'A fork needs a session to copy.', untrusted: false })
  expect(fakeLog(logFile).some((l) => l.startsWith('ARGV '))).toBe(false)

  const r = await bridge(page, 'consoleStart', { ...start, fork: true, forkOf: 'auth-tests' })
  expect(r.ok).toBe(true)
  await page.getByRole('complementary', { name: 'Conversations' }).getByText('Fork of auth-tests').click()
  await expect(page.getByRole('heading', { level: 2, name: 'Fork of auth-tests' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Conversation' }).getByText('Fork', { exact: true })).toBeVisible()
  await expect(log(page)).toContainText('Fake reply to: try the other approach')
  const argv = JSON.parse(fakeLog(logFile).find((l) => l.startsWith('ARGV '))!.slice(5)) as string[]
  expect(argv.slice(argv.indexOf('--resume'), argv.indexOf('--resume') + 3)).toEqual(['--resume', original, '--fork-session'])

  // The copy has its own session id: ending it and choosing Resume continues the copy, as a plain resume.
  await page.getByRole('button', { name: 'End conversation' }).click()
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await say(page, true, 'carry on')
  await expect(log(page)).toContainText('Fake reply to: carry on')
  const resumed = fakeLog(logFile).filter((l) => l.startsWith('ARGV ')).at(-1)!
  expect(resumed).toContain(`"--resume","${copy}"`)
  expect(resumed).not.toContain('--fork-session')
  expect(errors).toEqual([])
})

test('main refuses what the page may not ask for, and no conversation outlives the app', async () => {
  const { page, folder, logFile } = await live('console-guard')
  const ok: ConsoleStart = { cwd: folder, prompt: 'x', model: null, effort: 'low', permissionMode: 'default', resume: null, options: NO_OPTIONS }

  // Not a folder AgentDeck knows; not a mode or model the Console offers; not an id that could read as an option.
  expect(await rawBridge(page, 'consoleStart', { ...ok, cwd: 'C:\\Windows' })).toEqual({ ok: false, error: NOT_KNOWN, untrusted: false })
  for (const bad of [
    { ...ok, model: '--dangerously-skip-permissions' }, { ...ok, permissionMode: 'bypassPermissions' }, { ...ok, permissionMode: 'dontAsk' },
    { ...ok, resume: '--help' }, { ...ok, effort: 'ultra' }, { ...ok, prompt: '' }, { ...ok, dangerouslySkipPermissions: true }, { ...ok, cwd: '\\\\host\\share\\p' }
  ]) {
    expect(await rawBridge(page, 'consoleStart', bad), JSON.stringify(bad)).toMatchObject({ ok: false, untrusted: false })
  }
  expect(await rawBridge(page, 'consoleSend', 'c_00000000', 'hi')).toMatchObject({ ok: false })
  expect(await rawBridge(page, 'consoleSend', '../x', 'hi')).toMatchObject({ ok: false })
  expect(await rawBridge(page, 'consoleList')).toEqual([])

  // A running conversation is killed with the app (the process, and what it started).
  const started = await bridge(page, 'consoleStart', { ...ok, effort: 'low', permissionMode: 'plan', prompt: 'go slow please' })
  expect(started.ok).toBe(true)
  await expect.poll(() => fakeLog(logFile).some((l) => l.startsWith('PID ')), { timeout: 15_000 }).toBe(true)
  const pid = Number(fakeLog(logFile).find((l) => l.startsWith('PID '))!.slice(4))
  expect(alive(pid)).toBe(true)
  await closeApps()
  await expect.poll(() => alive(pid), { timeout: 10_000 }).toBe(false)
})

test('demo mode: the conversations render, a reply is scripted, nothing runs, and the page passes axe', async () => {
  const userData = profile('console-demo')
  writeFileSync(join(userData, 'config.json'), JSON.stringify({ demo: true }))
  const { app, page, errors } = await launch(userData)
  await expect(page.getByTestId('home')).toBeVisible()
  await goToConsole(page)

  const thread = log(page)
  await expect(thread).toContainText('Stream the invoice export')
  await expect(thread.getByRole('button', { name: /Run: npm test/ })).toHaveCount(2)
  await expect(thread.getByText('Failed', { exact: true })).toBeVisible()
  await expect(thread.getByRole('button', { name: /Copy ts code/ })).toBeVisible()
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)

  const axe = async (): Promise<string[]> =>
    (await new AxeBuilder({ page }).setLegacyMode(true).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
    )
  expect(await axe()).toEqual([])

  // Nothing is sent anywhere: a message gets the scripted reply, and the page still passes.
  await say(page, false, 'Please add a changelog entry')
  await expect(thread).toContainText('This is demo data, so nothing was sent to Claude')
  expect(await axe()).toEqual([])

  // What Claude can use, and the / menu, are believable in demo too (nothing is read from anywhere).
  await page.getByRole('button', { name: /^Capabilities/ }).click()
  const caps = page.getByRole('dialog', { name: 'What Claude can use here' })
  await expect(caps).toContainText('Model in use')
  await expect(caps.getByRole('tab', { name: /^servers/i })).toBeVisible()
  await page.keyboard.press('Escape')
  await composer(page, false).fill('/')
  await expect(page.getByRole('listbox', { name: 'Commands and skills' })).toBeVisible()
  expect(await axe()).toEqual([])
  await composer(page, false).fill('')

  // The smallest supported window.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 760))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Console')
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
  await page.keyboard.press('Control+n')
  await expect(page.getByRole('heading', { name: 'What should Claude work on?' })).toBeVisible()
  expect(await axe()).toEqual([])
  expect(errors).toEqual([])
})

test('a conversation started as a role with helpers, a mention in a later message, and a background task as a role', async () => {
  const persona = (name: string): string => `---\nname: ${name}\ndescription: ${name} does things.\nemoji: 🧪\nvibe: ${name} vibe\n---\n\n# ${name}\n\nYou are ${name}.\n`
  // The profile is CLAUDE_CONFIG_DIR: a clone with two roles, one of them also installed (an agent Claude Code lists).
  const files: [string, string][] = [
    ['agents/engineering-frontend-developer.md', 'Frontend Developer'],
    ['repos/agency-agents/engineering/engineering-frontend-developer.md', 'Frontend Developer'],
    ['repos/agency-agents/testing/testing-qa-engineer.md', 'QA Engineer']
  ]
  const { page, folder, logFile, userData, errors } = await live('console-role', { FAKE_CLAUDE_INSTALLED: 'Frontend Developer' }, (dir) => {
    for (const [rel, name] of files) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true })
      writeFileSync(join(dir, rel), persona(name))
    }
  })
  const catalog = (await bridge(page, 'listRoles')).roles
  const idOf = (name: string): string => catalog.find((r) => r.name === name)!.id
  const [cto, qa, fe] = [idOf('CTO'), idOf('QA Engineer'), idOf('Frontend Developer')]
  const meta = (): Record<string, { role?: string }> => (JSON.parse(readFileSync(join(userData, 'config.json'), 'utf8')) as { sessionMeta?: Record<string, { role?: string }> }).sessionMeta ?? {}
  const argvs = (): string[][] => fakeLog(logFile).filter((l) => l.startsWith('ARGV ')).map((l) => JSON.parse(l.slice(5)) as string[])
  const userTexts = (): string[] =>
    fakeLog(logFile).filter((l) => l.startsWith('IN ')).flatMap((l) => {
      const m = JSON.parse(l.slice(3)) as { type?: string; message?: { content?: string } }
      return m.type === 'user' && typeof m.message?.content === 'string' ? [m.message.content] : []
    })
  const shown = async (id: string): Promise<string[]> => (await bridge(page, 'consoleHistory', id)).flatMap((e) => (e.kind === 'user' ? [e.text] : []))
  const idle = (id: string) => expect.poll(async () => (await bridge(page, 'consoleList')).find((c) => c.id === id)?.state, { timeout: 15_000 }).toBe('idle')
  const base = { cwd: folder, model: null, effort: 'low', permissionMode: 'default', resume: null, options: NO_OPTIONS } as const

  // Start as the CTO (a role Claude Code does not have: a definitions file) with one helper of each kind.
  const started = await bridge(page, 'consoleStart', { ...base, prompt: 'plan the launch', role: cto, helpers: [qa, fe] })
  if (!started.ok) throw new Error(started.error)
  await idle(started.id)
  const argv = argvs()[0]!
  const file = argv[argv.indexOf('--agents') + 1]!
  expect(argv.slice(argv.indexOf('--agent'), argv.indexOf('--agent') + 2)).toEqual(['--agent', cto])
  expect(fakeLog(logFile)).toEqual(expect.arrayContaining(['AGENTS_FILE true', 'AGENT_FOUND true']))
  // Claude Code has read the file; AgentDeck deleted it, and nothing in the thread carries the role text or the helper line.
  await expect.poll(() => existsSync(file)).toBe(false)
  expect(userTexts()).toEqual(['plan the launch\n\nAvailable to consult: QA Engineer, Frontend Developer. Use them when their expertise applies.'])
  expect(await shown(started.id)).toEqual(['plan the launch'])
  expect((await bridge(page, 'consoleList'))[0]).toMatchObject({ role: { id: cto, name: 'CTO' }, helpers: [{ id: qa }, { id: fe }] })
  await expect.poll(() => meta()[FAKE_SESSION]?.role).toBe(cto)

  // A later message that names a helper: Claude Code is asked to use that subagent, the thread keeps the user's own words.
  expect(await bridge(page, 'consoleSend', started.id, 'check the signup form', [qa])).toEqual({ ok: true })
  await expect.poll(() => userTexts().at(-1)).toBe('Use the QA Engineer subagent for this: check the signup form')
  await idle(started.id)
  expect((await shown(started.id)).at(-1)).toBe('check the signup form')

  // Main checks ids, counts and combinations whatever the page sent.
  for (const bad of [{ role: 'ghost' }, { role: '../cto' }, { role: 'C:\\roles\\cto.md' }, { role: cto, helpers: ['a1', 'a2', 'a3', 'a4', 'a5'] }, { helpers: [qa] }, { role: cto, resume: FAKE_SESSION }]) {
    expect(await rawBridge(page, 'consoleStart', { ...base, prompt: 'x', ...bad }), JSON.stringify(bad)).toMatchObject({ ok: false, untrusted: false })
  }
  expect(await rawBridge(page, 'consoleSend', started.id, 'hi', ['ghost'])).toMatchObject({ ok: false })
  expect(await rawBridge(page, 'consoleSend', started.id, 'hi', ['../x'])).toMatchObject({ ok: false })

  // The Composer's "send to an agent" as a role: the installed one goes by its exact name, and the session is noted under the id claude printed.
  const sent = await bridge(page, 'dispatch', { prompt: 'Fix the flaky login test', cwd: folder, agent: null, effort: 'low', role: fe })
  expect(sent).toMatchObject({ ok: true, bgId: 'fakebg1' })
  const bg = argvs().find((a) => a.includes('--bg'))!
  expect(bg.slice(bg.indexOf('--agent'), bg.indexOf('--agent') + 2)).toEqual(['--agent', 'Frontend Developer'])
  await expect.poll(() => meta()['bg:fakebg1']?.role).toBe(fe)
  // The fake is an npm-style .cmd shim, which can not carry a role Claude Code does not have: said in words, nothing started.
  expect(await bridge(page, 'dispatch', { prompt: 'Plan it', cwd: folder, agent: null, effort: 'low', role: cto })).toMatchObject({ ok: false, error: expect.stringContaining('claude.cmd') })
  expect(await bridge(page, 'dispatch', { prompt: 'Plan it', cwd: folder, agent: 'code-reviewer', effort: 'low', role: fe })).toMatchObject({ ok: false, error: 'Pick a role or a subagent, not both.' })
  expect(argvs().filter((a) => a.includes('--bg'))).toHaveLength(1)
  expect(errors).toEqual([])
})
