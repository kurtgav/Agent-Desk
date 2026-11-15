import { Check } from 'lucide-react'
import { EOD_NOTES_MAX } from '@shared/work'
import { Button } from '../ui'
import { useNotes, type NotesState } from './useEod'

const COUNTER_FROM = Math.floor(EOD_NOTES_MAX * 0.85)

function SaveState({ state, retry }: { state: NotesState; retry(): void }) {
  return (
    <span role="status" className="flex min-h-6 items-center gap-2 text-[12px] text-muted">
      {state === 'saving' && 'Saving…'}
      {state === 'saved' && (
        <>
          <Check size={13} strokeWidth={2} className="text-[var(--done-ink)]" aria-hidden />
          Saved
        </>
      )}
      {state === 'error' && (
        <>
          <span className="text-[var(--failed-ink)]">Could not save. Your text is still here.</span>
          <Button size="sm" onClick={retry}>
            Try again
          </Button>
        </>
      )}
    </span>
  )
}

/**
 * Your own words for the day: the one part of the report AgentDeck never writes and that stays editable on a closed
 * day. It saves 0.8 s after you stop typing; the text is kept on screen whatever happens to the save.
 */
export function NotesField({ day, initial }: { day: string; initial: string }) {
  const { text, state, edit, retry } = useNotes(day, initial)
  return (
    <section aria-labelledby="eod-notes">
      <div className="flex items-center justify-between gap-3 border-b border-rule pb-2.5">
        <h3 id="eod-notes" className="t-title">
          <label htmlFor="eod-notes-field">Notes</label>
        </h3>
        <SaveState state={state} retry={retry} />
      </div>
      <div className="mt-3 rounded-tile border border-line bg-ground/60 px-4 py-3 transition-[border-color,background-color] duration-150 focus-within:border-accent focus-within:bg-surface">
        <textarea
          id="eod-notes-field"
          value={text}
          maxLength={EOD_NOTES_MAX}
          onChange={(e) => edit(e.target.value)}
          placeholder="Anything to remember about this day. It saves as you type, and AgentDeck never rewrites it."
          className="block max-h-72 min-h-24 w-full resize-none bg-transparent text-[14px] leading-6 outline-none field-sizing-content placeholder:text-muted"
        />
      </div>
      {text.length >= COUNTER_FROM && (
        <p className="mt-1 text-right text-[12px] tabular-nums text-muted">
          {text.length} / {EOD_NOTES_MAX}
        </p>
      )}
    </section>
  )
}
