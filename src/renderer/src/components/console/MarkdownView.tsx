import { Fragment, memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { Code, cn } from '../ui'
import { copyToClipboard } from './clipboard'
import { parseMarkdown, type Block, type Inline } from './markdown'

/** Every node here is an element with text children: no HTML is ever parsed, and no link is an anchor (markdown.ts). */

function Spans({ spans }: { spans: Inline[] }): ReactNode {
  return spans.map((s, i) => {
    switch (s.t) {
      case 'text':
        return <Fragment key={i}>{s.s}</Fragment>
      case 'code':
        return <Code key={i}>{s.s}</Code>
      case 'strong':
        return <strong key={i} className="font-semibold"><Spans spans={s.c} /></strong>
      case 'em':
        return <em key={i}><Spans spans={s.c} /></em>
      case 'del':
        return <del key={i} className="text-muted"><Spans spans={s.c} /></del>
      case 'link':
        // The address is shown, not followed: the reader decides whether it is theirs to open.
        return (
          <span key={i}>
            <span className="font-medium"><Spans spans={s.c} /></span>
            {s.url && <span className="text-muted [overflow-wrap:anywhere]"> ({s.url})</span>}
          </span>
        )
    }
  })
}

export function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async (): Promise<void> => {
    if (!(await copyToClipboard(text))) return
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1_600)
  }
  return (
    <figure className="overflow-hidden rounded-tile border border-line bg-well">
      <figcaption className="flex h-8 items-center justify-between border-b border-line pl-3 pr-1 text-[12px] text-muted">
        <span>{lang || 'text'}</span>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={copied ? 'Copied' : `Copy ${lang || 'text'} code`}
          className="press inline-flex h-6 items-center gap-1 rounded-md px-1.5 font-medium hover:bg-active hover:text-ink"
        >
          {copied ? <Check size={13} strokeWidth={2} aria-hidden /> : <Copy size={13} strokeWidth={1.75} aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </figcaption>
      <pre tabIndex={0} className="overflow-x-auto px-3 py-2.5 font-mono text-[13px] leading-5 text-ink"><code className="text-[1em]">{text}</code></pre>
    </figure>
  )
}

const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const

function Cursor() {
  return <span aria-hidden className="ml-0.5 inline-block h-4 w-[3px] translate-y-0.5 animate-pulse rounded-sm bg-muted motion-reduce:animate-none" />
}

/** `cursor` marks where text still being written ends: inside the last paragraph, or after any other last block. */
function Blocks({ blocks, cursor = false }: { blocks: Block[]; cursor?: boolean }): ReactNode {
  return blocks.map((b, i) => {
    switch (b.t) {
      case 'p':
        return <p key={i}><Spans spans={b.c} />{cursor && i === blocks.length - 1 && <Cursor />}</p>
      case 'h': {
        const Tag = b.level === 3 ? 'h3' : b.level === 4 ? 'h4' : 'h5'
        return <Tag key={i} className={cn('mt-2 text-balance', b.level === 3 ? 't-heading' : 't-title')}><Spans spans={b.c} /></Tag>
      }
      case 'code':
        return <CodeBlock key={i} lang={b.lang} text={b.text} />
      case 'quote':
        return <blockquote key={i} className="space-y-3 border-l-2 border-control pl-4 text-muted"><Blocks blocks={b.c} /></blockquote>
      case 'hr':
        return <hr key={i} className="border-0 border-t border-rule" />
      case 'list': {
        const Tag = b.ordered ? 'ol' : 'ul'
        return (
          <Tag key={i} start={b.ordered ? b.start : undefined} className={cn('space-y-1.5 pl-6 marker:text-muted', b.ordered ? 'list-decimal' : 'list-disc')}>
            {b.items.map((item, j) => (
              <li key={j} className="space-y-2 pl-1"><Blocks blocks={item} /></li>
            ))}
          </Tag>
        )
      }
      case 'table':
        return (
          <div key={i} className="overflow-x-auto rounded-tile border border-line">
            <table className="w-full border-collapse text-[13px] leading-5">
              <thead className="bg-well">
                <tr>
                  {b.head.map((h, k) => (
                    <th key={k} scope="col" className={cn('px-3 py-1.5 font-medium', ALIGN[b.align[k] ?? 'left'])}><Spans spans={h} /></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r} className="border-t border-rule">
                    {row.map((cell, k) => (
                      <td key={k} className={cn('px-3 py-1.5 align-top', ALIGN[b.align[k] ?? 'left'])}><Spans spans={cell} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
    }
  })
}

/** Claude's words as a document: 15 px on a 26 px line, blocks 12 px apart. `streaming` adds a quiet cursor at the end. */
export const Markdown = memo(function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const blocks = parseMarkdown(text)
  return (
    <div className="space-y-3 text-[15px] leading-[26px] text-ink [overflow-wrap:anywhere]">
      <Blocks blocks={blocks} cursor={streaming} />
      {streaming && blocks.at(-1)?.t !== 'p' && <Cursor />}
    </div>
  )
})
