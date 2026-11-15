import { describe, expect, it } from 'vitest'
import { demoModels } from './demo'
import { rowsOf } from './ModelPicker'

describe('the model picker rows', () => {
  it('lists every model Claude Code offers: Default and its main models first, the rest under More models', () => {
    const { main, more } = rowsOf(demoModels())
    expect(main.map((r) => r.label)).toEqual(['Default', 'Opus 5.5', 'Fable 5.2', 'Sonnet 5.5', 'Haiku 5.5'])
    expect(main[0]).toMatchObject({ value: null, hint: 'Opus 5.5 · Best for everyday, complex tasks' })
    expect(more.map((r) => r.label)).toEqual(['Fable 5.1', 'Haiku 4.5', 'Sonnet 5', 'Opus 5', 'Fable 5', 'Opus 4.8', 'Opus 4.7', 'Opus 4.6', 'Sonnet 4.6'])
    expect(more.find((r) => r.label === 'Opus 4.7')?.value).toBe('claude-opus-4-7')
  })

  it('offers the aliases until Claude Code answers', () => {
    const { main, more } = rowsOf(null)
    expect(main.map((r) => r.value)).toEqual([null, 'opus', 'sonnet', 'haiku', 'fable'])
    expect(more).toEqual([])
  })
})
