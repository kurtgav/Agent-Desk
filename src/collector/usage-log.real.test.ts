// BENCHMARK, not a unit test: reads the REAL Claude Code logs of the machine it runs on, so it only runs on request
// (`AGENTDECK_REAL_LOGS=1 npx vitest run src/collector/usage-log.real.test.ts --reporter=verbose`). It prints counts, sizes and timings,
// never a path or any content. The numbers that go with the budget (hook ingest p95 < 20 ms) are the stalls it reports.
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { Store } from './store'
import { UsageLogWatcher, logRoots } from './usage-log'

const log = (...a: unknown[]): void => console.log('[usage-log bench]', ...a)

describe.skipIf(!process.env.AGENTDECK_REAL_LOGS)('first scan of the real logs', () => {
  it('reads them in slices that never block the loop', async () => {
    const roots = logRoots()
    expect(roots.length).toBeGreaterThan(0)
    // What there is to read: the .jsonl files touched in the last 8 days, counted separately from the code under test.
    const recent = roots
      .flatMap((r) => readdirSync(r, { recursive: true }).map((n) => join(r, String(n))))
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => statSync(f))
      .filter((s) => Date.now() - s.mtimeMs < 8 * 86_400_000)
    log(`to read: ${recent.length} files, ${(recent.reduce((n, s) => n + s.size, 0) / 1_048_576).toFixed(0)} MB (modified in the last 8 days)`)
    // Control: the same probe on an idle loop for 6 s, so a stall caused by the machine (other programs) is told apart from one caused by the scan.
    {
      let worstIdle = 0
      let lastIdle = performance.now()
      const idle = setInterval(() => {
        const now = performance.now()
        worstIdle = Math.max(worstIdle, now - lastIdle)
        lastIdle = now
      }, 1)
      await new Promise((r) => setTimeout(r, 6_000))
      clearInterval(idle)
      log(`idle loop for 6 s, same probe: max gap ${worstIdle.toFixed(0)} ms`)
    }
    // Which single operation is the longest? Time every JSON.parse of a log line (the only unbounded unit of work in a slice).
    const parse = JSON.parse
    let slowest = { ms: 0, chars: 0 }
    JSON.parse = ((text: string, reviver?: (k: string, v: unknown) => unknown) => {
      const t = performance.now()
      const r = parse(text, reviver) as unknown
      const ms = performance.now() - t
      if (ms > slowest.ms) slowest = { ms, chars: text.length }
      return r
    }) as typeof JSON.parse
    const dir = mkdtempSync(join(tmpdir(), 'agentdeck-bench-'))
    const db = join(dir, 'agentdeck.db')
    try {
      for (const round of ['first scan', 'restart (nothing changed)']) {
        const store = new Store(db)
        const delay = monitorEventLoopDelay({ resolution: 1 })
        let worst = 0
        let last = performance.now()
        const probe = setInterval(() => {
          const now = performance.now()
          worst = Math.max(worst, now - last)
          last = now
        }, 1)
        delay.enable()
        const t0 = performance.now()
        const w = new UsageLogWatcher({ roots, store: store.usageLog, onChange: () => undefined, onError: (e) => log('error', String(e).slice(0, 80)), watch: false })
        w.start()
        await w.idle()
        const seconds = (performance.now() - t0) / 1000
        delay.disable()
        clearInterval(probe)
        const rows = [...store.usageLog.records()]
        log(
          `${round}: ${w.status().files} files read, ${seconds.toFixed(1)} s, max loop stall ${worst.toFixed(0)} ms (probe) / ${(delay.max / 1e6).toFixed(0)} ms (histogram), p99 ${(delay.percentile(99) / 1e6).toFixed(1)} ms, p50 ${(delay.percentile(50) / 1e6).toFixed(1)} ms; ${rows.length} messages kept`
        )
        const s0 = performance.now()
        const u = store.snapshot(Date.now(), { awaySince: null, awayUntil: null, agentDefinitionCount: 0, usageLogs: w.status() }).usage
        log(`${round}: building the card's figures from ${rows.length} messages took ${(performance.now() - s0).toFixed(1)} ms`)
        log(`${round}: week tokens ${u?.weekTokens}, week cost $${u?.weekCostUsd.toFixed(2)}${u?.costPartial ? ' (partial)' : ''}, block tokens ${u?.block?.tokens ?? 'none'}, top models ${u?.topModels?.length}`)
        w.stop()
        store.close()
      }
    } finally {
      JSON.parse = parse
      log(`slowest single JSON.parse: ${slowest.ms.toFixed(0)} ms for a line of ${(slowest.chars / 1024).toFixed(0)} KB`)
      rmSync(dir, { recursive: true, force: true })
    }
  }, 600_000)
})
