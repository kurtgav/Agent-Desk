import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { utilityProcess } from 'electron'
import type { CollectorInit, ToCollector } from '@shared/collector'
import { restartDelay, superviseCollector } from './collector'

vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() } }))

describe('restartDelay (ARCHITECTURE § Crash restart)', () => {
  it('doubles from 500 ms and caps at 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 20].map(restartDelay)).toEqual([500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000])
  })
})

/** Stands in for the utility process: records what main sends, and lets a test emit replies and exits. */
class FakeProc extends EventEmitter {
  sent: unknown[] = []
  postMessage(m: unknown): void {
    this.sent.push(m)
  }
  kill(): void {
    this.emit('exit', 0)
  }
}

describe('Supervisor request/reply (D-089)', () => {
  const init = { type: 'init' } as unknown as CollectorInit
  const detail = (reqId: number): ToCollector => ({ type: 'detail', reqId, sessionId: 's1' })
  let procs: FakeProc[]

  beforeEach(() => {
    vi.useFakeTimers()
    procs = []
    vi.mocked(utilityProcess.fork).mockImplementation(() => {
      const p = new FakeProc()
      procs.push(p)
      return p as never
    })
  })
  afterEach(() => vi.useRealTimers())

  const lastReqId = (p: FakeProc): number => (p.sent.at(-1) as { reqId: number }).reqId

  it('hands a reply to the request with its reqId, and everything else to onMessage', async () => {
    const onMessage = vi.fn()
    const s = superviseCollector('collector.js', init, onMessage, vi.fn())
    const reply = s.request(detail)
    const reqId = lastReqId(procs[0]!)
    procs[0]!.emit('message', { type: 'error', message: 'unrelated' })
    procs[0]!.emit('message', { type: 'detail', reqId, detail: null })
    await expect(reply).resolves.toEqual({ type: 'detail', reqId, detail: null })
    expect(onMessage).toHaveBeenCalledTimes(1)
    s.stop()
  })

  it('resolves null after 5 s without a reply, and drops the late reply', async () => {
    const onMessage = vi.fn()
    const s = superviseCollector('collector.js', init, onMessage, vi.fn())
    const reply = s.request(detail)
    const reqId = lastReqId(procs[0]!)
    vi.advanceTimersByTime(5_000)
    await expect(reply).resolves.toBeNull()
    procs[0]!.emit('message', { type: 'detail', reqId, detail: null })
    expect(onMessage).not.toHaveBeenCalled()
    s.stop()
  })

  it('answers waiting requests with null when the collector exits, and replays only visibility and focus', async () => {
    const onDown = vi.fn()
    const s = superviseCollector('collector.js', init, vi.fn(), onDown)
    s.post({ type: 'visible', visible: true })
    s.post({ type: 'dismiss', id: 'a1' })
    const reply = s.request(detail)
    procs[0]!.emit('exit', 1)
    await expect(reply).resolves.toBeNull()
    expect(onDown).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(500)
    expect(procs[1]!.sent).toEqual([init, { type: 'visible', visible: true }])
    s.stop()
    await expect(s.request(detail)).resolves.toBeNull()
  })
})
