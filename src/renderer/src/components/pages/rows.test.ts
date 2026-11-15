import { describe, expect, it } from 'vitest'
import type { History } from '@shared/detail'
import { demoAgentNote } from '@/demo/work'
import { byDay, splitPath } from './rows'

describe('splitPath', () => {
  it('names the file and its folder inside the project, whatever the slashes and case', () => {
    expect(splitPath('D:\\clients\\Harbor\\app\\booking\\Form.tsx', 'd:\\clients\\harbor')).toEqual({ dir: 'app/booking', name: 'Form.tsx' })
    expect(splitPath('D:\\clients\\harbor\\README.md', 'D:\\clients\\harbor\\')).toEqual({ dir: '', name: 'README.md' })
  })
  it('keeps the whole folder when the file is outside the project or the project is unknown', () => {
    expect(splitPath('D:\\other\\x\\a.ts', 'D:\\clients\\harbor')).toEqual({ dir: 'D:/other/x', name: 'a.ts' })
    expect(splitPath('D:\\other\\a.ts', '')).toEqual({ dir: 'D:/other', name: 'a.ts' })
  })
})

describe('byDay', () => {
  const row = (id: string, ts: number): History['activity'][number] => ({ id, ts, kind: 'tool.started', summary: id, agentType: null, sessionId: 's' })
  it('splits newest-first rows into consecutive local days', () => {
    const at = (d: number, h: number): number => new Date(2026, 10, d, h).getTime()
    const groups = byDay([row('a', at(13, 15)), row('b', at(13, 9)), row('c', at(12, 22)), row('d', at(10, 8))])
    expect(groups.map((g) => g.rows.map((r) => r.id).join(''))).toEqual(['ab', 'c', 'd'])
    expect(byDay([])).toEqual([])
  })
})

describe('demoAgentNote', () => {
  it('fills in the demo subagents only, and leaves live definitions alone', () => {
    const plain = { name: 'Explore', description: '', model: null, scope: 'user' as const }
    expect(demoAgentNote(plain, true).description).toMatch(/search/i)
    expect(demoAgentNote(plain, true).model).toBe('haiku')
    expect(demoAgentNote(plain, false)).toBe(plain)
    expect(demoAgentNote({ ...plain, name: 'mine' }, true).description).toBe('')
  })
})
