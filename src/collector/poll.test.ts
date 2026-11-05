import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from './events'
import { BACKOFF_MS, HIDDEN_MS, MIN_GAP_MS, NUDGE_MS, Poller, VISIBLE_MS, diffRows, exePaths, parseRows, surfaceFromExe, type Row } from './poll'

const row = (o: Partial<Row> = {}): Row => ({ pid: 7, cwd: 'D:\\p', kind: 'interactive', startedAt: 1, sessionId: 's1', name: 'web', status: 'idle', ...o })

describe('parseRows', () => {
  it('keeps valid rows, skips bad ones, and rejects non-arrays', () => {
    expect(parseRows('{}')).toBeNull()
    expect(parseRows('nope')).toBeNull()
    expect(parseRows(JSON.stringify([row(), { pid: 'x' }, { status: 'idle' }, { kind: 'background', id: 'abc' }]))).toEqual([
      row(),
      { kind: 'background', id: 'abc' }
    ])
  })
})

describe('surfaceFromExe (D-021)', () => {
  it.each([
    ['C:\\Users\\k\\AppData\\Local\\Claude-Data\\claude_1\\claude-code\\2.1.317\\claude.exe', 'interactive', 'desktop'],
    ['C:\\Program Files\\WindowsApps\\Claude_1.0_x64\\app\\claude.exe', 'interactive', 'desktop'],
    ['C:\\Users\\k\\.vscode\\extensions\\anthropic.claude-code-2.1\\claude.exe', 'interactive', 'vscode'],
    ['C:\\Users\\k\\.vscode-insiders\\extensions\\anthropic.claude-code-2.1\\claude.exe', 'interactive', 'vscode'],
    ['C:\\Users\\k\\.cursor\\extensions\\x\\claude.exe', 'interactive', 'vscode'],
    ['C:\\Users\\k\\.local\\bin\\claude.exe', 'interactive', 'cli'],
    ['C:\\Users\\k\\.local\\bin\\claude.exe', 'background', 'background'],
    [null, 'interactive', 'cli']
  ] as const)('%s (%s) → %s', (exe, kind, surface) => {
    expect(surfaceFromExe(exe, kind)).toBe(surface)
  })
})

describe('diffRows', () => {
  const surfaces = new Map([[7, 'desktop' as const]])

  it('emits session.state for new and changed rows, nothing for unchanged ones, session.gone for vanished ones', () => {
    const first = diffRows(new Map(), [row(), row({ sessionId: 's2', pid: 8 })], surfaces, 100)
    expect(first.events.map((e) => [e.kind, e.sessionId])).toEqual([['session.state', 's1'], ['session.state', 's2']])
    expect(first.events[0]!.payload).toMatchObject({ status: 'idle', surface: 'desktop' })
    expect(first.events[1]!.payload).toMatchObject({ surface: 'cli' })

    const same = diffRows(first.next, [row(), row({ sessionId: 's2', pid: 8 })], surfaces, 200)
    expect(same.events).toEqual([])

    const changed = diffRows(same.next, [row({ status: 'waiting', waitingFor: 'input needed' })], surfaces, 300)
    expect(changed.events.map((e) => [e.kind, e.sessionId, e.source])).toEqual([['session.state', 's1', 'poll'], ['session.gone', 's2', 'poll']])
  })

  it('keys background rows without a sessionId by their short id', () => {
    const { events } = diffRows(new Map(), [{ kind: 'background', id: 'afc6', state: 'working' }], surfaces, 1)
    expect(events[0]).toMatchObject({ sessionId: 'bg:afc6', payload: { surface: 'background' } })
  })

  it('stores only the documented fields, masked and capped (security review MEDIUM-3)', () => {
    const loose = { ...row({ name: 'n'.repeat(500), waitingFor: 'token=abc123' }), env: { API_KEY: 'x' }, extra: 'drop me' } as Row
    const p = diffRows(new Map(), [loose], surfaces, 1).events[0]!.payload
    expect(Object.keys(p).sort()).toEqual(['cwd', 'kind', 'name', 'pid', 'sessionId', 'startedAt', 'status', 'surface', 'waitingFor'])
    expect(p.waitingFor).toBe('token=•••')
    expect((p.name as string).length).toBeLessThanOrEqual(201)
  })
})

describe('exePaths', () => {
  it('asks PowerShell (by absolute path) for integer pids only and parses Id<TAB>Path lines', async () => {
    const exec = vi.fn().mockResolvedValue({ code: 0, stdout: '7\tC:\\a\\claude.exe\r\n8\t\r\n' })
    const paths = await exePaths([7, 8, -1, 1.5], exec)
    expect(exec.mock.calls[0]![0]).toMatch(/^[A-Z]:\\.+\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i)
    const script = exec.mock.calls[0]![1].at(-1) as string
    expect(script).toContain('Get-Process -Id 7,8 ')
    expect([...paths!]).toEqual([[7, 'C:\\a\\claude.exe'], [8, null], [-1, null], [1.5, null]])
  })

  it('reports a failed call as null, so nothing gets cached as CLI', async () => {
    expect(await exePaths([7], vi.fn().mockResolvedValue({ code: null, stdout: '' }))).toBeNull()
  })
})

describe('Poller cadence (D-005, ADR-0004)', () => {
  let polls: number[]
  let output: string | null
  let emitted: AgentEvent[][]
  let poller: Poller

  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 })
    polls = []
    output = JSON.stringify([row()])
    emitted = []
    poller = new Poller({
      list: async () => {
        polls.push(Date.now())
        return output === null ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: output, stderr: '' }
      },
      exePaths: async (pids) => new Map(pids.map((p) => [p, null])),
      emit: (e) => emitted.push(e)
    })
  })
  afterEach(() => {
    poller.stop()
    vi.useRealTimers()
  })

  const at = () => polls.map((t) => t - 1_000_000)

  it('polls at once, then every 3 s while visible and every 15 s while hidden', async () => {
    poller.start()
    await vi.advanceTimersByTimeAsync(VISIBLE_MS * 2)
    expect(at()).toEqual([0, VISIBLE_MS, VISIBLE_MS * 2])
    poller.setVisible(false) // the poll already due still runs; the gaps after it are 15 s
    await vi.advanceTimersByTimeAsync(VISIBLE_MS + HIDDEN_MS)
    expect(at().slice(3)).toEqual([VISIBLE_MS * 3, VISIBLE_MS * 3 + HIDDEN_MS])
    expect(emitted).toHaveLength(5) // every poll reports, so held-back rows can settle (D-058)…
    expect(emitted.filter((e) => e.length)).toHaveLength(1) // …but the row never changed after the first one
  })

  it('polls every second while a P1 item is open, then falls back (ARCHITECTURE § 3)', async () => {
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    poller.setFastUntil(1_000_000 + 3_500)
    await vi.advanceTimersByTimeAsync(7_000)
    expect(at()).toEqual([0, 1_000, 2_000, 3_000, 4_000, 4_000 + VISIBLE_MS])
    poller.setFastUntil(0) // closed: no change to the next poll
    await vi.advanceTimersByTimeAsync(VISIBLE_MS)
    expect(at().at(-1)).toBe(4_000 + VISIBLE_MS * 2)
  })

  it('ends sessions the store still thought live when the first poll does not list them (D-057)', async () => {
    poller.stop()
    poller = new Poller(
      { list: async () => ({ code: 0, stdout: output!, stderr: '' }), exePaths: async () => new Map(), emit: (e) => emitted.push(e) },
      ['s1', 'gone-while-closed']
    )
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(emitted[0]!.map((e) => [e.kind, e.sessionId])).toEqual([['session.state', 's1'], ['session.gone', 'gone-while-closed']])
  })

  it('retries a failed exe lookup after the backoff instead of caching the pid as CLI', async () => {
    poller.stop()
    const lookups: number[] = []
    let fail = true
    poller = new Poller({
      list: async () => ({ code: 0, stdout: output!, stderr: '' }),
      exePaths: async (pids) => {
        lookups.push(Date.now() - 1_000_000)
        return fail ? null : new Map(pids.map((p) => [p, 'C:\\Users\\k\\AppData\\Local\\Claude-Data\\claude.exe']))
      },
      emit: (e) => emitted.push(e)
    })
    poller.start()
    await vi.advanceTimersByTimeAsync(VISIBLE_MS * 2)
    expect(lookups).toEqual([0])
    expect(emitted[0]![0]!.payload.surface).toBe('cli')
    fail = false
    await vi.advanceTimersByTimeAsync(BACKOFF_MS)
    expect(lookups).toHaveLength(2)
    expect(emitted.flat().at(-1)!.payload.surface).toBe('desktop')
  })

  it('emits nothing once stopped, even from a poll already in flight', async () => {
    let release: (v: { code: number; stdout: string; stderr: string }) => void = () => undefined
    poller.stop()
    poller = new Poller({ list: () => new Promise((r) => (release = r)), exePaths: async () => new Map(), emit: (e) => emitted.push(e) })
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    poller.stop()
    release({ code: 0, stdout: output!, stderr: '' })
    await vi.advanceTimersByTimeAsync(0)
    expect(emitted).toEqual([])
  })

  it('a hook nudge polls 300 ms later, but never within 1 s of the last poll', async () => {
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    poller.nudge()
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS)
    expect(at()).toEqual([0, MIN_GAP_MS])
    await vi.advanceTimersByTimeAsync(1_500)
    poller.nudge()
    await vi.advanceTimersByTimeAsync(NUDGE_MS)
    expect(at()).toEqual([0, MIN_GAP_MS, MIN_GAP_MS + 1_500 + NUDGE_MS])
  })

  it('backs off to 60 s on a failed poll and ignores nudges meanwhile', async () => {
    output = null
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    poller.nudge()
    await vi.advanceTimersByTimeAsync(BACKOFF_MS - 1)
    expect(at()).toEqual([0])
    await vi.advanceTimersByTimeAsync(1)
    expect(at()).toEqual([0, BACKOFF_MS])
  })
})
