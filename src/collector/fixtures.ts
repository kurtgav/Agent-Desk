// Test helper: the real 2.1.318 hook payloads (spike S1), in the order and at the times they arrived.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const HOOK_FIXTURES = join('test', 'fixtures', 'hooks', '2.1.318')

export interface Delivery {
  name: string
  ts: number
  raw: string
}

/** `_requests.jsonl` logs every delivery; the n-th `Event` in it was saved as `Event-n.json`. */
export function s1Deliveries(): Delivery[] {
  const counts: Record<string, number> = {}
  return readFileSync(join(HOOK_FIXTURES, '_requests.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { t: number; event: string })
    .map(({ t, event }) => {
      counts[event] = (counts[event] ?? 0) + 1
      const name = `${event}-${counts[event]}`
      return { name, ts: t, raw: readFileSync(join(HOOK_FIXTURES, `${name}.json`), 'utf8') }
    })
}

export function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(HOOK_FIXTURES, `${name}.json`), 'utf8')) as Record<string, unknown>
}
