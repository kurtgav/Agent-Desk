import { describe, expect, it } from 'vitest'
import { parseModels } from './console-models'

// The shape of Claude Code 2.1.325's `initialize` answer, models only (the real one also carries the account, never read here).
const answer = (models: unknown[], requestId = 'agentdeck-models'): string =>
  JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response: { commands: [], account: { email: 'x@y.z' }, models } } })

const REAL = [
  { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', description: 'Opus 5.5 · Best for everyday, complex tasks', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'fable', resolvedModel: 'claude-fable-5-2', displayName: 'Fable 5.2', description: 'For your toughest challenges', supportsEffort: true, supportedEffortLevels: ['low', 'high'] },
  { value: 'claude-haiku-4-5-20251001', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', description: 'Fastest for quick answers', supportsEffort: false }
]

describe('parseModels', () => {
  it('reads the models Claude Code lists, with their names, lines and effort levels, and nothing else', () => {
    expect(parseModels(answer(REAL))).toEqual([
      { value: 'default', label: 'Default (recommended)', description: 'Opus 5.5 · Best for everyday, complex tasks', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
      { value: 'fable', label: 'Fable 5.2', description: 'For your toughest challenges', efforts: ['low', 'high'] },
      { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', description: 'Fastest for quick answers', efforts: [] }
    ])
  })

  it('ignores other lines, other requests, and values that could read as an option', () => {
    expect(parseModels('{"type":"system","subtype":"init"}')).toBeNull()
    expect(parseModels('not json')).toBeNull()
    expect(parseModels(answer(REAL, 'someone-else'))).toBeNull()
    expect(parseModels(answer([{ value: '--dangerously-skip-permissions', displayName: 'x' }, { value: 'opus' }]))).toEqual([{ value: 'opus', label: 'opus', description: '', efforts: [] }])
  })
})
