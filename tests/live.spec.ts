import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { fixture, s1Deliveries } from '../src/collector/fixtures'

// Live mode end to end: hook POSTs → collector → main → renderer, with the real S1 payloads.
const MAIN = '.'
const EVIDENCE = 'docs/evidence'

let app: ElectronApplication | undefined
let userData = ''

function appEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('CLAUDE')) env[k] = v
  return { ...env, AGENTDECK_USER_DATA: userData, AGENTDECK_POLL: '0', CLAUDE_CONFIG_DIR: userData }
}

interface Endpoint {
  port: number
  token: string
}

async function open(): Promise<{ page: Page; errors: string[]; endpoint: Endpoint }> {
  userData = mkdtempSync(join(tmpdir(), 'agentdeck-live-'))
  mkdirSync(join(userData, 'agents'))
  for (const name of ['reviewer', 'planner']) writeFileSync(join(userData, 'agents', `${name}.md`), `---\nname: ${name}\n---\n`)
  app = await electron.launch({ args: [MAIN], env: appEnv() })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!
    w.unmaximize()
    w.setSize(1440, 924)
    w.center()
  })
  await expect(page.getByTestId('home')).toBeVisible()
  // The collector writes its port to config.json once it listens (the same file M3's installer reads).
  await expect.poll(readEndpoint, { timeout: 15_000 }).not.toBeNull()
  return { page, errors, endpoint: readEndpoint()! }
}

function readEndpoint(): Endpoint | null {
  try {
    const c = JSON.parse(readFileSync(join(userData, 'config.json'), 'utf8')) as { collectorPort?: number; token?: string }
    return c.collectorPort && c.token ? { port: c.collectorPort, token: c.token } : null
  } catch {
    return null // not written yet, or caught mid-write
  }
}

function post(e: Endpoint, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: e.port, method: 'POST', path: '/hooks', headers: { 'x-agentdeck-token': e.token, 'content-type': 'application/json' } },
      (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 0))
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}

test.afterEach(async () => {
  await app?.close().catch(() => undefined)
  app = undefined
  rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

test('live Home starts empty and honest, then shows a started tool within 1 s', async () => {
  const { page, errors, endpoint } = await open()
  expect(await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getTitle())).toBe('AgentDeck')
  await expect(page.getByRole('banner').getByText('Demo data', { exact: true })).toHaveCount(0)
  await expect(page.getByText('All quiet.')).toBeVisible()
  const running = page.getByRole('region', { name: 'Running now' })
  await expect(running).toContainText('No agent is running.')
  await expect(page.getByRole('region', { name: 'Tasks finished' })).toContainText('0')
  await expect(page.getByRole('region', { name: 'Your agents' })).toContainText('No sessions this week.')
  await expect(page.getByRole('region', { name: 'Recent files' })).toContainText('No files changed this week.')
  await expect(page.getByRole('complementary', { name: 'Sidebar' }).getByText('All agents')).toBeVisible()

  const session_id = 'e2e-latency'
  expect(await post(endpoint, JSON.stringify({ ...fixture('UserPromptSubmit-1'), session_id }))).toBe(200)
  await expect(running).toContainText('Thinking')
  const sent = Date.now()
  await post(endpoint, JSON.stringify({ ...fixture('PreToolUse-5'), session_id }))
  await expect(running.getByRole('listitem').filter({ hasText: 'echo spike-from-shell' })).toBeVisible({ timeout: 1_000 })
  test.info().annotations.push({ type: 'hook → Running now', description: `${Date.now() - sent} ms` })
  expect(errors).toEqual([])
})

test('the S1 run plays out live: nested subagent, finished turns, changed file', async () => {
  const { page, errors, endpoint } = await open()
  const deliveries = s1Deliveries()
  const subagentAt = deliveries.findIndex((d) => d.name === 'SubagentStart-1')
  for (const d of deliveries.slice(0, subagentAt + 1)) expect(await post(endpoint, d.raw)).toBe(200)

  // Given a subagent spawns, it appears nested under its parent with its type and task.
  const nested = page.getByRole('region', { name: 'Running now' }).getByRole('list', { name: /subagents$/ })
  await expect(nested).toContainText('Explore')
  await expect(nested).toContainText('Count files in scratch folder')
  await page.mouse.move(0, 0)
  mkdirSync(EVIDENCE, { recursive: true })
  await page.screenshot({ path: join(EVIDENCE, 'm2-live-subagent.png') })

  for (const d of deliveries.slice(subagentAt + 1)) await post(endpoint, d.raw)
  await expect(page.getByRole('region', { name: 'Running now' })).toContainText('No agent is running.')
  await expect(page.getByRole('region', { name: 'Tasks finished' })).toContainText('6')
  await expect(page.getByRole('region', { name: 'Files changed' })).toContainText('1')
  await expect(page.getByRole('region', { name: 'Recent files' })).toContainText('hello.txt')
  await expect(page.getByRole('region', { name: 'Your agents' }).getByRole('listitem').first()).toContainText('scratch')
  await expect(page.getByRole('complementary', { name: 'Sidebar' })).toContainText('Explore')
  await page.screenshot({ path: join(EVIDENCE, 'm2-live-after.png') })
  expect(errors).toEqual([])
})

test('Demo data toggles between sample and live data without losing live history', async () => {
  const { page, errors, endpoint } = await open()
  await post(endpoint, JSON.stringify({ ...fixture('UserPromptSubmit-1'), session_id: 'e2e-keep' }))
  await expect(page.getByRole('region', { name: 'Running now' })).toContainText('Thinking')

  const toggle = async (): Promise<void> => {
    await page.getByRole('button', { name: 'Third Code workspace menu' }).click()
    await page.getByRole('menuitemcheckbox', { name: /Demo data/ }).click()
  }
  await toggle()
  await expect(page.getByRole('banner').getByText('Demo data', { exact: true })).toBeVisible()
  await expect(page.getByText('3 things need your OK.', { exact: false })).toBeVisible()
  await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getTitle())).toBe('AgentDeck (Demo)')
  expect(JSON.parse(readFileSync(join(userData, 'config.json'), 'utf8')).demo).toBe(true)

  await toggle()
  await expect(page.getByRole('banner').getByText('Demo data', { exact: true })).toHaveCount(0)
  // The collector restarted on the same database: the session is still there, but nobody saw it work since (D-057).
  await expect(page.getByRole('region', { name: 'Your agents' }).getByRole('listitem').first()).toContainText('scratch')
  await expect(page.getByRole('region', { name: 'Running now' })).toContainText('No agent is running.')
  await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getTitle())).toBe('AgentDeck')
  expect(errors).toEqual([])
})
