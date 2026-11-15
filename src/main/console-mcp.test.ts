import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { McpList, parseMcpList } from './console-mcp'

const FAKE = resolve('test/fixtures/fake-claude.mjs')
const cmd = { file: process.execPath, args: [FAKE] }
// `claude mcp list` on 2.1.323, with the commands, URLs and reasons the parser must never pass on.
const REAL = [
  'Checking MCP server health…', '',
  'claude.ai Figma: https://mcp.example.com/figma?token=sk-ant-api03-SECRETSECRETSECRET - ✔ Connected',
  'plugin:expo:expo: https://api.example.com/mcp - ! Needs authentication',
  'github: npx -y @modelcontextprotocol/server-github --token ghp_abcdefghijklmnopqrstuvwxyz0123456789 - ✘ Failed to connect — ECONNREFUSED: Unable to connect',
  'caveman: node C:\\Users\\someone\\caveman.js --api-key=hunter2 - ✔ Connected',
  'pencil: C:\\tools\\pencil.exe --app desktop - ✘ Failed to connect — CONNECTION_CLOSED: Connection closed',
  'docs: https://x.example/mcp - ⏸ Pending approval', ''
].join('\n')

describe('parseMcpList', () => {
  it('keeps each server’s name and how it is doing, and nothing else', () => {
    const servers = parseMcpList(REAL)
    expect(servers).toEqual([
      { name: 'claude.ai Figma', status: 'connected' }, { name: 'plugin:expo:expo', status: 'needs-auth' }, { name: 'github', status: 'failed' },
      { name: 'caveman', status: 'connected' }, { name: 'pencil', status: 'failed' }, { name: 'docs', status: 'pending' }
    ])
    const shown = JSON.stringify(servers)
    for (const leak of ['SECRET', 'ghp_', 'hunter2', 'api-key', 'token', 'https', 'C:\\', 'ECONNREFUSED', 'npx']) expect(shown).not.toContain(leak)
  })

  it('reads a list with colour codes and CRLF line ends', () => {
    expect(parseMcpList('\u001b[32mcaveman: node x.js - ✔ Connected\u001b[0m\r\nother: https://a.example - ✘ Failed to connect — nope\r\n')).toEqual([
      { name: 'caveman', status: 'connected' }, { name: 'other', status: 'failed' }
    ])
  })

  it('says an empty list is empty', () => {
    expect(parseMcpList('No MCP servers configured. Use `claude mcp add` to add a server.')).toEqual([])
  })

  it.each([
    ['plain garbage', 'foo bar\nbaz'], ['json', '{"servers":[{"name":"a"}]}'], ['an env dump', 'AWS_SECRET_ACCESS_KEY=abc123\nPATH=C:\\x'], ['control characters', '\u0000\u0001 nothing: here'],
    ['a status line with no name', ': https://a.example - ✔ Connected'], ['empty', ''], ['only the header', 'Checking MCP server health…\n\n']
  ])('returns null for %s (the caller says it could not read the list)', (_why, text) => {
    expect(parseMcpList(text)).toBeNull()
  })

  it('drops a line whose "name" is a URL, an assignment, or a secret', () => {
    const text = [
      'https://user:pw@host.example/x: cmd - ✔ Connected', 'TOKEN=abc: cmd - ✔ Connected', 'sk-ant-api03-ABCDEFGHIJKLMNOP: cmd - ✔ Connected', 'fine: cmd - ✔ Connected'
    ].join('\n')
    expect(parseMcpList(text)).toEqual([{ name: 'fine', status: 'connected' }])
  })

  it('caps a huge list and does not choke on a huge line', () => {
    const many = Array.from({ length: 500 }, (_, i) => `server-${i}: https://x.example/${i} - ✔ Connected`).join('\n')
    expect(parseMcpList(`${many}\n${'x'.repeat(2_000_000)}`)).toHaveLength(100)
    expect(parseMcpList('a'.repeat(2_000_000))).toBeNull()
  })
})

describe('McpList (the real process manager against the fake `claude mcp list`)', () => {
  let dir: string
  let log: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentdeck-mcp-'))
    log = join(dir, 'fake.log')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const env = (mode: string): NodeJS.ProcessEnv => ({ ...process.env, FAKE_MCP_LIST: mode, FAKE_CLAUDE_LOG: log })

  it('lists, reduced to names and status', async () => {
    const r = await new McpList().list(cmd, null, env('normal'))
    expect(r).toMatchObject({ ok: true, cached: false })
    expect(r.ok && r.servers.map((s) => s.name)).toEqual(['claude.ai Figma', 'plugin:expo:expo', 'github', 'caveman'])
    expect(JSON.stringify(r)).not.toMatch(/SECRET|ghp_|hunter2|someone/)
  })

  it('keeps the answer for a minute, per folder, and checks again after that', async () => {
    let now = 1_000
    const list = new McpList(5_000, 60_000, () => now)
    expect(await list.list(cmd, null, env('normal'))).toMatchObject({ cached: false })
    now += 59_000
    expect(await list.list(cmd, null, env('normal'))).toMatchObject({ ok: true, cached: true, at: 1_000 })
    expect(await list.list(cmd, process.cwd(), env('normal'))).toMatchObject({ cached: false })
    now += 2_000
    expect(await list.list(cmd, null, env('normal'))).toMatchObject({ cached: false })
  })

  it('answers “could not read” for output it does not understand, showing nothing raw', async () => {
    const r = await new McpList().list(cmd, null, env('garbage'))
    expect(r).toEqual({ ok: false, error: 'Could not read the list.' })
  })

  it('reports an empty list, a failing command and a huge answer', async () => {
    expect(await new McpList().list(cmd, null, env('none'))).toMatchObject({ ok: true, servers: [] })
    expect(await new McpList().list(cmd, null, env('fail'))).toMatchObject({ ok: false, error: expect.stringContaining('exit code 2') })
    const huge = await new McpList().list(cmd, null, env('huge'))
    expect(huge.ok && huge.servers).toHaveLength(100)
  })

  it('gives up after the time limit and stops the process', async () => {
    const t0 = Date.now()
    const r = await new McpList(400).list(cmd, null, env('hang'))
    expect(r).toEqual({ ok: false, error: expect.stringContaining('did not finish checking') })
    expect(Date.now() - t0).toBeLessThan(10_000)
  })

  it('can be cancelled while it runs', async () => {
    const list = new McpList(20_000)
    const running = list.list(cmd, null, env('hang'))
    await new Promise((r) => setTimeout(r, 300))
    list.cancel()
    expect(await running).toEqual({ ok: false, error: 'Cancelled.' })
  })

  it('shares one check between two askers', async () => {
    const list = new McpList()
    const [a, b] = await Promise.all([list.list(cmd, null, env('normal')), list.list(cmd, null, env('normal'))])
    expect(a).toEqual(b)
  })
})
