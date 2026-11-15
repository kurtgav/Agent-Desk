import { Fragment, type ReactNode } from 'react'
import { Code } from '../ui'

/**
 * A role's text, shown as plain formatted text: headings, lists, paragraphs, `code` and **bold**. It is built from React text nodes, so
 * markup in the role (HTML, scripts, links, images) shows as the characters it is and never runs (ADR-0010). Not a markdown renderer:
 * it knows the few shapes persona files use.
 */

export type Block = { kind: 'heading'; text: string } | { kind: 'para'; text: string } | { kind: 'list'; ordered: boolean; items: string[] } | { kind: 'code'; text: string }

const FENCE = /^\s*```/

export function blocks(text: string): Block[] {
  const out: Block[] = []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  // One holder, so the flush below and the loop agree on what is open (a plain `let` narrows to null across calls).
  const open: { para: string[]; list: { ordered: boolean; items: string[] } | null } = { para: [], list: null }
  const flush = (): void => {
    if (open.para.length) out.push({ kind: 'para', text: open.para.join(' ') })
    if (open.list) out.push({ kind: 'list', ...open.list })
    open.para = []
    open.list = null
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (FENCE.test(line)) {
      flush()
      const code: string[] = []
      while (++i < lines.length && !FENCE.test(lines[i]!)) code.push(lines[i]!)
      out.push({ kind: 'code', text: code.join('\n') })
      continue
    }
    const heading = /^\s{0,3}#{1,6}\s+(.*\S)\s*$/.exec(line)
    const bullet = /^\s*[-*+]\s+(.*\S)\s*$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*\S)\s*$/.exec(line)
    if (heading) {
      flush()
      out.push({ kind: 'heading', text: heading[1]! })
    } else if (bullet || numbered) {
      const ordered = !bullet
      if (open.para.length || (open.list && open.list.ordered !== ordered)) flush()
      open.list ??= { ordered, items: [] }
      open.list.items.push((bullet ?? numbered)![1]!)
    } else if (line.trim() === '') {
      flush()
    } else if (open.list && /^\s+\S/.test(line)) {
      open.list.items[open.list.items.length - 1] += ` ${line.trim()}`
    } else {
      if (open.list) flush()
      open.para.push(line.trim())
    }
  }
  flush()
  return out
}

function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i} className="font-semibold text-ink">{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <Code key={i}>{part.slice(1, -1)}</Code>
    return <Fragment key={i}>{part}</Fragment>
  })
}

export function PromptPreview({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2.5 text-[13px] leading-5 text-muted [overflow-wrap:anywhere]">
      {blocks(text).map((b, i) => {
        switch (b.kind) {
          case 'heading':
            return <p key={i} className="mt-2 font-semibold text-ink first:mt-0">{inline(b.text)}</p>
          case 'para':
            return <p key={i} className="text-pretty">{inline(b.text)}</p>
          case 'code':
            return <pre key={i} className="overflow-x-auto rounded-lg bg-well p-3 font-mono text-[12px] leading-4 text-ink">{b.text}</pre>
          case 'list': {
            const List = b.ordered ? 'ol' : 'ul'
            return (
              <List key={i} className={b.ordered ? 'list-decimal pl-5' : 'list-disc pl-5'}>
                {b.items.map((it, j) => (
                  <li key={j} className="pl-1 text-pretty">{inline(it)}</li>
                ))}
              </List>
            )
          }
        }
      })}
    </div>
  )
}
