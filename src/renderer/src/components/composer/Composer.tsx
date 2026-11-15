import { useId, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { PROMPT_MAX } from '@shared/bridge'
import { CONSOLE_PROMPT_MAX } from '@shared/console'
import { TASK_TITLE_MAX } from '@shared/work'
import { setDraft, useConsole } from '../console/store'
import { IconButton, cn } from '../ui'
import { AdvancedPanel } from './Advanced'
import { Anchored } from './Anchored'
import { MentionField } from './MentionField'
import { MentionMenu } from './MentionMenu'
import { CliNotice, FailNotice, Flash } from './Notices'
import { RoleChips } from './RoleChips'
import { RolePicker } from './RolePicker'
import { ProjectChip } from './Settings'
import { SlashList } from './SlashList'
import { Suggestions } from './Suggestions'
import { Ended, NewSessionToolbar, ReplyToolbar, SendButton } from './Toolbars'
import { variantOf, type ComposerProps } from './props'
import { MENTIONS_MAX } from './types'
import { useComposer, type Model } from './useComposer'

const CARD =
  'rounded-card border border-line bg-surface transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent/15'

/** The words the box is named by: they say which kind of message it takes. */
const LABEL = { 'new-session': 'First message for a new conversation', reply: 'Message for Claude Code', task: 'Add a task' } as const
const FIELD_ID = { 'new-session': 'composer-input', reply: 'composer-reply', task: 'quick-add' } as const

function placeholderFor(m: Model): string {
  if (m.variant === 'task') return 'What do you want done today? @ picks an agent. Enter adds it'
  if (m.variant === 'reply') return m.running ? 'Add a follow-up. It runs after this turn.' : 'Reply to Claude, or type @ to ask an agent…'
  if (m.draft.resume) return `What next? Claude picks up where that session left off${m.draft.resume.fork ? ', in a copy' : ''}.`
  return 'Describe what you want done. Type @ to bring in an agent, / for a command.'
}

/** What a screen reader hears while a menu is open: how many entries, or why there are none. */
function announcement(m: Model): string {
  const { menus } = m
  if (!menus.open) return ''
  const n = menus.count
  if (menus.kind === 'mention') return n ? `${n} ${n === 1 ? 'agent' : 'agents'}` : m.ix.ready ? 'No agent matches.' : 'Reading the agents.'
  return n ? `${n} ${n === 1 ? 'match' : 'matches'}` : menus.slash.note === 'load' ? 'Start the conversation to load them.' : 'Nothing matches.'
}

/**
 * The one composer. `new-session` starts a conversation, with `Run in the background` beside Send; `reply` writes in an open one;
 * `task` adds a task. Typing `@` brings any agent into the message as a chip (the first leads a session), `/` brings commands and
 * skills, and up to three agents are suggested from what is being typed. Nothing here calls a model: AgentDeck only starts the
 * user's own Claude Code.
 */
export function Composer(props: ComposerProps) {
  const m = useComposer(props)
  const card = useRef<HTMLFormElement>(null)
  const advancedId = useId()
  const [advanced, setAdvanced] = useState(false)
  const variant = variantOf(props)
  const task = variant === 'task'
  const here = variant === 'new-session'
  const dismissFailure = (): void => (m.problem ? m.setProblem(null) : useConsole.setState({ startProblem: null }))
  const start = here ? m.startProblem : null
  const failure = m.problem ?? (start ? { message: start.message, ...(start.untrusted ? { untrustedIn: start.cwd } : {}) } : null)
  const suggest = (id: string): void => {
    const role = m.ix.get(id)
    if (role) m.addRole(role)
  }

  if (m.variant === 'reply' && m.over) return <Ended m={m} onResume={props.variant === 'reply' ? props.onResume : undefined} />

  const field = (
    <MentionField
      id={FIELD_ID[variant]}
      label={LABEL[variant]}
      value={m.text}
      placeholder={placeholderFor(m)}
      maxLength={task ? TASK_TITLE_MAX : variant === 'reply' ? CONSOLE_PROMPT_MAX : Math.max(PROMPT_MAX, CONSOLE_PROMPT_MAX)}
      size={task ? 'task' : 'message'}
      singleLine={task}
      minHeight={task ? 'min-h-6' : here ? 'min-h-[72px]' : 'min-h-[52px]'}
      spans={m.spans}
      colorOf={(id) => m.ix.get(id)?.color ?? null}
      menu={{ expanded: m.menus.open && m.menus.count > 0, controls: m.menus.listId, activeId: m.menus.activeId }}
      inputRef={m.el}
      onValue={m.onValue}
      onCaret={m.setCaret}
      onFocusChange={m.setFocused}
      onKeyDown={m.onKeyDown}
      {...(task ? {} : { onImages: (files: File[]) => void m.pasteImages(files) })}
    />
  )

  return (
    <div className={props.className}>
      <form
        ref={card}
        onSubmit={(e) => {
          e.preventDefault()
          void m.send()
        }}
        className={cn(CARD, task ? 'border-control py-2 pl-4 pr-2' : 'px-4 pb-2.5 pt-3.5')}
      >
        {here && m.draft.resume && (
          <p className="mb-2 flex items-center gap-1.5 text-[13px] text-muted">
            <span>{m.draft.resume.fork ? 'Forking' : 'Continuing'}</span>
            <span className="max-w-72 truncate font-medium text-ink">{m.draft.resume.name}</span>
            {m.draft.resume.fork && <span className="flex-none">as a copy. The original stays as it is.</span>}
            <IconButton aria-label="Start a new conversation instead" className="size-6" onClick={() => setDraft({ resume: null })}>
              <X size={13} strokeWidth={1.75} />
            </IconButton>
          </p>
        )}
        {props.variant === 'task' ? (
          <div className="flex items-center gap-2">
            <Plus size={16} strokeWidth={1.75} aria-hidden className="flex-none text-muted" />
            <div className="min-w-0 flex-1">{field}</div>
            <RolePicker mode={m.picker} index={m.ix} recent={m.recent} onPick={m.pickFromPicker} onClose={() => m.setPicker(null)}>
              <div className="flex flex-none items-center">
                <RoleChips variant="task" ids={m.ids} index={m.ix} actions={m.chips} />
              </div>
            </RolePicker>
            <ProjectChip cwd={props.project} none onPick={props.onProjectChange} />
            <SendButton m={m} />
          </div>
        ) : (
          <>
            {m.images.length > 0 && (
              <ul className="mb-2 flex flex-wrap gap-2" aria-label="Attached images">
                {m.images.map((img, i) => (
                  <li key={i} className="relative">
                    <img src={`data:${img.mediaType};base64,${img.data}`} alt={`Attached image ${i + 1}`} className="size-14 rounded-md border border-line object-cover" />
                    <IconButton aria-label={`Remove image ${i + 1}`} className="absolute -right-1.5 -top-1.5 size-5 rounded-full bg-surface" onClick={() => m.dropImage(i)}>
                      <X size={11} strokeWidth={2} />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
            {field}
            {here ? <NewSessionToolbar m={m} advanced={advanced} advancedId={advancedId} onAdvanced={() => setAdvanced((v) => !v)} /> : <ReplyToolbar m={m} />}
            {here && advanced && (
              <div className="-mx-4 mt-2.5">
                <AdvancedPanel id={advancedId} />
              </div>
            )}
          </>
        )}
        {task && (
          <div className="mt-2 pl-6 empty:hidden">
            <Suggestions hits={m.suggested} index={m.ix} onPick={suggest} />
          </div>
        )}
        {m.cli && <CliNotice problem={m.cli} />}
        {failure && <FailNotice problem={failure} onDismiss={dismissFailure} />}
        {(m.flash ?? m.overLimitNote) && !failure && <Flash>{m.flash ?? m.overLimitNote}</Flash>}
        <p role="status" className="sr-only">
          {announcement(m)}
        </p>
      </form>
      {here && (
        <div className="mt-3 min-h-7 px-1">
          <Suggestions hits={m.suggested} index={m.ix} onPick={suggest} />
        </div>
      )}
      {m.menus.open && (
        <Anchored anchor={card} prefer={task ? 'bottom' : 'top'}>
          {(room) =>
            m.menus.kind === 'slash' ? (
              <SlashList items={m.menus.slash.items} index={m.menus.index} note={m.menus.slash.note} onPick={m.pickAt} onActive={m.menus.setActive} />
            ) : (
              <MentionMenu menus={m.menus} ready={m.ix.ready} full={!task && m.ids.length >= MENTIONS_MAX[variant]} room={room} onPick={m.pickAt} />
            )
          }
        </Anchored>
      )}
    </div>
  )
}
