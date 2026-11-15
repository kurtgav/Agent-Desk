import { describe, expect, it } from 'vitest'
import { MODEL_ALIASES, MODEL_PATTERN, RESUME_PATTERN, TOOL_RULE, TOOL_RULES_MAX, isFallbackModels } from './console'

describe('permission rules (--allowedTools, --disallowedTools, the live allow list)', () => {
  it.each([
    'Read', 'Edit', 'Bash', 'WebFetch', 'mcp__server', 'mcp__claude_ai_Figma__whoami', 'mcp__plugin_ui-color-palette_ui-color-palette__get_palette', 'mcp__server__*',
    'Bash(git status:*)', 'Bash(npm test)', 'Bash(git diff *)', 'Read(./src/**)', 'WebFetch(domain:example.com)', 'Edit(C:\\work\\src\\**)', 'Bash(npm run build -- --mode=prod)'
  ])('accepts %s', (rule) => {
    expect(TOOL_RULE.test(rule)).toBe(true)
  })

  it.each([
    ['empty', ''], ['an option', '--dangerously-skip-permissions'], ['a short option', '-p'], ['starts with a digit', '1Bash'], ['leading space', ' Bash'],
    ['space before the paren', 'Bash (x)'], ['a list', 'Read, Edit'], ['a list with a comma in the specifier', 'Bash(a,b)'], ['empty specifier', 'Bash()'],
    ['semicolon', 'Bash(rm -rf /; echo)'], ['and', 'Bash(a && b)'], ['pipe', 'Bash(a | b)'], ['backtick', 'Bash(`id`)'], ['dollar', 'Bash($HOME)'],
    ['redirect', 'Bash(a > b)'], ['double quote', 'Bash(echo "x")'], ['single quote', "Bash(echo 'x')"], ['percent (cmd.exe expands it)', 'Bash(%PATH%)'],
    ['caret (cmd.exe escape)', 'Bash(a^b)'], ['bang', 'Bash(a!b)'], ['newline', 'Bash(a\nb)'], ['carriage return', 'Bash(a\rb)'], ['nested parens', 'Bash(a(b))'],
    ['space in a name', 'mcp__a b'], ['name too long', 'x'.repeat(81)], ['specifier too long', `Bash(${'a'.repeat(201)})`], ['trailing text', 'Bash(a) b'], ['brace', 'Bash({a})']
  ])('rejects %s', (_why, rule) => {
    expect(TOOL_RULE.test(rule)).toBe(false)
  })

  it('caps how many rules one conversation takes', () => {
    expect(TOOL_RULES_MAX).toBe(20)
  })
})

describe('model choices', () => {
  it('knows the aliases the CLI offers on this version', () => {
    expect([...MODEL_ALIASES]).toEqual(['opus', 'sonnet', 'haiku', 'fable'])
  })

  it.each(['opus', 'sonnet', 'haiku', 'fable', 'claude-sonnet-5-5', 'claude-opus-4-5[1m]', 'claude-haiku-4-5-20251001', 'a'.repeat(64)])('accepts %s', (m) => {
    expect(MODEL_PATTERN.test(m)).toBe(true)
  })

  it.each(['', '-x', '--model', ' opus', 'a b', 'opus;rm', 'model"x', 'a'.repeat(65), 'sonnet\n', '[1m]'])('rejects %j', (m) => {
    expect(MODEL_PATTERN.test(m)).toBe(false)
  })

  it('takes up to three comma-separated fallback models, each a model', () => {
    expect(isFallbackModels('sonnet')).toBe(true)
    expect(isFallbackModels('sonnet,haiku')).toBe(true)
    expect(isFallbackModels('claude-opus-4-8,sonnet,haiku')).toBe(true)
    for (const bad of ['', 'a,b,c,d', 'a,,b', '-x', 'a, b', 'a,-b', 'sonnet;haiku']) expect(isFallbackModels(bad), bad).toBe(false)
  })

  it('never lets a resume id read as an option', () => {
    expect(RESUME_PATTERN.test('--help')).toBe(false)
    expect(RESUME_PATTERN.test('11111111-2222-4333-8444-555555555555')).toBe(true)
  })
})
