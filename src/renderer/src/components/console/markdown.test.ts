import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown } from './MarkdownView'
import { parseInline, parseMarkdown, safeUrl, type Block } from './markdown'

const html = (text: string): string => renderToString(createElement(Markdown, { text }))
const types = (blocks: Block[]): string[] => blocks.map((b) => b.t)

describe('blocks', () => {
  it('reads paragraphs, headings (shrunk below the page title), rules and quotes', () => {
    const blocks = parseMarkdown('# Title\n\nFirst line\nsecond line.\n\n### Smaller\n\n---\n\n> quoted\n> more')
    expect(types(blocks)).toEqual(['h', 'p', 'h', 'hr', 'quote'])
    expect(blocks[0]).toMatchObject({ level: 3 })
    expect(blocks[2]).toMatchObject({ level: 4 })
    expect(blocks[1]).toMatchObject({ t: 'p', c: [{ t: 'text', s: 'First line\nsecond line.' }] })
  })

  it('reads fenced code with its language, and keeps what is inside as it is', () => {
    const [code] = parseMarkdown('```ts\nconst a = "<b>x</b>"\n# not a heading\n```')
    expect(code).toEqual({ t: 'code', lang: 'ts', text: 'const a = "<b>x</b>"\n# not a heading' })
  })

  it('treats a fence that is still open (text being written) as code so far', () => {
    expect(parseMarkdown('Here:\n\n```js\nlet x = 1')).toEqual([
      { t: 'p', c: [{ t: 'text', s: 'Here:' }] },
      { t: 'code', lang: 'js', text: 'let x = 1' }
    ])
  })

  it('reads a longer fence, and ~~~ fences, and does not end on a shorter one', () => {
    expect(parseMarkdown('````\n```\ninner\n```\n````')).toEqual([{ t: 'code', lang: '', text: '```\ninner\n```' }])
    expect(parseMarkdown('~~~\nx\n~~~')).toEqual([{ t: 'code', lang: '', text: 'x' }])
  })

  it('reads bulleted, numbered and nested lists', () => {
    const [ul, ol] = parseMarkdown('- one\n- two\n  - nested\n- three\n\n3. third\n4. fourth')
    expect(ul).toMatchObject({ t: 'list', ordered: false })
    expect(ul?.t === 'list' && ul.items).toHaveLength(3)
    const two = ul?.t === 'list' ? ul.items[1] : []
    expect(types(two ?? [])).toEqual(['p', 'list'])
    expect(ol).toMatchObject({ t: 'list', ordered: true, start: 3 })
    expect(ol?.t === 'list' && ol.items).toHaveLength(2)
  })

  it('reads a table with its alignment, padding short rows', () => {
    const [table] = parseMarkdown('| Name | Qty |\n| :--- | ---: |\n| a | 1 |\n| b |')
    expect(table).toMatchObject({ t: 'table', align: ['left', 'right'] })
    expect(table?.t === 'table' && table.rows).toHaveLength(2)
    expect(table?.t === 'table' && table.rows[1]).toHaveLength(2)
  })

  it('does not take a lone pipe line or a bullet-less dash for structure', () => {
    expect(types(parseMarkdown('a | b\nstill a paragraph'))).toEqual(['p'])
    expect(types(parseMarkdown('2 * 3 * 4 = 24'))).toEqual(['p'])
  })

  it('stops, instead of recursing for ever, on deeply nested input', () => {
    const deep = `${'> '.repeat(40)}x\n${'- '.repeat(40)}y`
    expect(parseMarkdown(deep).length).toBeGreaterThan(0)
  })
})

describe('inline', () => {
  it('reads code, bold, italic and strikethrough, and leaves unclosed markers alone', () => {
    expect(parseInline('a `b` **c** *d* ~~e~~')).toEqual([
      { t: 'text', s: 'a ' }, { t: 'code', s: 'b' }, { t: 'text', s: ' ' }, { t: 'strong', c: [{ t: 'text', s: 'c' }] }, { t: 'text', s: ' ' },
      { t: 'em', c: [{ t: 'text', s: 'd' }] }, { t: 'text', s: ' ' }, { t: 'del', c: [{ t: 'text', s: 'e' }] }
    ])
    expect(parseInline('**open and `never closed')).toEqual([{ t: 'text', s: '**open and `never closed' }])
    expect(parseInline('snake_case_name and 2 * 3')).toEqual([{ t: 'text', s: 'snake_case_name and 2 * 3' }])
  })

  it('keeps markers inside code spans literal', () => {
    expect(parseInline('`**not bold** <b>`')).toEqual([{ t: 'code', s: '**not bold** <b>' }])
  })

  it('reads a link as its text and its address', () => {
    expect(parseInline('see [the docs](https://example.com/a_(b)) now')).toEqual([
      { t: 'text', s: 'see ' }, { t: 'link', c: [{ t: 'text', s: 'the docs' }], url: 'https://example.com/a_(b)' }, { t: 'text', s: ' now' }
    ])
  })

  it('drops the address of any link that is not http, https or mailto', () => {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///C:/Windows/win.ini', 'vbscript:x', '//evil.example/x', ' javascript:alert(1)']) {
      const [link] = parseInline(`[click](${bad})`)
      expect(link, bad).toMatchObject({ t: 'link', url: null })
    }
    expect(safeUrl('mailto:me@example.com')).toBe('mailto:me@example.com')
    expect(safeUrl('https://a.example/x?y=1#z')).toBe('https://a.example/x?y=1#z')
    expect(safeUrl('https://a.example/x y')).toBeNull()
  })
})

describe('rendering never produces HTML from the text', () => {
  it('shows a tag as text', () => {
    const out = html('Hello <script>alert(1)</script> <img src=x onerror=alert(1)> <b>bold?</b>')
    expect(out).not.toMatch(/<script|<img|<b>/)
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('never makes an anchor, and shows an unsafe link as plain text without its address', () => {
    const out = html('[a](javascript:alert(1)) [b](data:text/html;base64,PHNjcmlwdD4=) [c](https://example.com) <a href="https://evil.example">d</a> https://auto.example')
    expect(out).not.toMatch(/<a[ >]/i)
    expect(out).not.toMatch(/<[a-z][^>]*\s(?:href|src|on\w+)=/i)
    expect(out).not.toMatch(/javascript:alert|base64/i)
    expect(out.replace(/<!-- -->/g, '')).toContain('(https://example.com)')
    expect(out).toContain('&lt;a href=')
  })

  it('shows markup inside code as code', () => {
    const out = html('```html\n<script>alert(1)</script>\n```\nand `<img onerror=x>`')
    expect(out).not.toMatch(/<script|<img/)
    expect(out).toContain('&lt;script&gt;')
    expect(out).toContain('Copy')
    expect(out).toContain('>html<')
  })

  it('renders lists, tables and headings as real elements, headings below the page title', () => {
    const out = html('## Heading\n\n- a\n- b\n\n1. x\n\n| h1 | h2 |\n| --- | --- |\n| c1 | c2 |')
    expect(out).toMatch(/<h3[^>]*>Heading<\/h3>/)
    expect(out).toContain('<ul')
    expect(out).toContain('<ol')
    expect(out).toContain('<th scope="col"')
    expect(out).not.toMatch(/<h1|<h2/)
  })

  it('has no dangerouslySetInnerHTML in the renderer', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('./MarkdownView.tsx', import.meta.url), 'utf8')
    expect(src).not.toContain('dangerouslySetInnerHTML')
    expect(src).not.toMatch(/<a[\s>]/)
  })
})
