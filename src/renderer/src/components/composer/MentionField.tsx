import { useMemo, type ClipboardEvent, type KeyboardEvent, type RefObject } from 'react'
import { cn } from '../ui'
import { segmentsOf, type MentionSpan } from './mentions'
import { imageFiles } from './pasteImages'

/** Both layers set their text with exactly this, so the highlight behind the box lands on the words in front of it. */
const METRICS = 'm-0 border-0 p-0 font-[inherit] tracking-normal whitespace-pre-wrap [overflow-wrap:break-word] [word-break:normal]'

export interface MenuAria {
  expanded: boolean
  controls: string | undefined
  activeId: string | undefined
}

interface Props {
  id?: string
  /** The accessible name: it says which kind of message the box takes. */
  label: string
  value: string
  placeholder: string
  maxLength: number
  /** `message` is the conversation's 15 px; `task` the Tasks list's 14 px. */
  size: 'message' | 'task'
  /** A task title is one line: Enter sends, and a pasted line break becomes a space. */
  singleLine: boolean
  /** The height the empty box keeps, as a Tailwind class. */
  minHeight: string
  spans: readonly MentionSpan[]
  colorOf(id: string): string | null
  menu: MenuAria
  inputRef: RefObject<HTMLTextAreaElement | null>
  onValue(text: string): void
  onCaret(at: number): void
  onFocusChange(focused: boolean): void
  onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void
  /** Pictures pasted into the box (a screenshot, a copied image). Absent: the box takes text only. */
  onImages?(files: File[]): void
}

/** Pasted line breaks for a one-line field, written as the browser would have: one `insertText`, so undo stays one step. */
function pasteOneLine(e: ClipboardEvent<HTMLTextAreaElement>): void {
  const text = e.clipboardData.getData('text/plain')
  if (!/[\r\n]/.test(text)) return
  e.preventDefault()
  document.execCommand('insertText', false, text.replace(/\s*[\r\n]+\s*/g, ' '))
}

/**
 * The message box. A plain `textarea` does everything a text box should (the input method, undo and redo, paste, selection, the
 * screen reader); behind it a second layer draws the same words with each mention as a chip-coloured pill. The textarea's own text is
 * transparent and its caret is not, so what you see is the layer behind. The two sit in one grid cell, so the layer decides the
 * height and the box grows with it, with no measuring and no scroll syncing; the pill's padding is cancelled by an equal negative
 * margin, so it takes no width and the words never move.
 */
export function MentionField({ id, label, value, placeholder, maxLength, size, singleLine, minHeight, spans, colorOf, menu, inputRef, onValue, onCaret, onFocusChange, onKeyDown, onImages }: Props) {
  const segments = useMemo(() => segmentsOf(value, spans), [value, spans])
  const type = size === 'task' ? 'text-[14px] leading-6' : 'text-[15px] leading-6'
  return (
    <div className={cn('grid overflow-y-auto overscroll-contain', singleLine ? 'max-h-24' : 'max-h-52', minHeight)}>
      <div aria-hidden className={cn(METRICS, type, 'pointer-events-none col-start-1 row-start-1 select-none text-ink')}>
        {segments.map((s, i) => {
          if (s.id === null) return <span key={i}>{s.text}</span>
          const c = colorOf(s.id) ?? 'var(--accent)'
          return (
            <span
              key={i}
              data-mention={s.id}
              className="rounded-md px-[3px] py-px [margin-inline:-3px] [box-decoration-break:clone]"
              style={{
                background: `color-mix(in oklab, ${c} ${s.lead ? 24 : 15}%, var(--surface))`,
                boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${c} ${s.lead ? 42 : 26}%, transparent)`
              }}
            >
              {s.text}
            </span>
          )
        })}
        {/* A last empty line has no height of its own in a div; a zero-width space gives it one, as the box has. */}
        {value.endsWith('\n') ? '​' : ''}
      </div>
      <textarea
        id={id}
        ref={inputRef}
        value={value}
        rows={1}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label={label}
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={menu.expanded}
        aria-controls={menu.controls}
        aria-activedescendant={menu.activeId}
        spellCheck
        style={{ caretColor: 'var(--ink)' }}
        className={cn(METRICS, type, 'col-start-1 row-start-1 block h-full w-full resize-none overflow-hidden bg-transparent text-transparent outline-none placeholder:text-muted')}
        onChange={(e) => {
          onValue(e.target.value)
          onCaret(e.target.selectionStart)
        }}
        onSelect={(e) => onCaret(e.currentTarget.selectionStart)}
        onPaste={(e) => {
          const files = onImages ? imageFiles(e.clipboardData) : []
          if (files.length) {
            // A copied picture has no text with it; when it does (copied from a page), the text still pastes.
            if (!e.clipboardData.getData('text/plain')) e.preventDefault()
            return onImages?.(files)
          }
          if (singleLine) pasteOneLine(e)
        }}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}

/**
 * Replaces `[from, to)` of the box with `insert` as the browser's own edit, so undo and redo treat it as typing. False when the
 * browser would not (the caller then sets the text itself).
 */
export function editRange(el: HTMLTextAreaElement | null, from: number, to: number, insert: string): boolean {
  if (!el) return false
  try {
    el.focus()
    el.setSelectionRange(from, to)
    return insert === '' ? document.execCommand('delete') : document.execCommand('insertText', false, insert)
  } catch {
    return false
  }
}
