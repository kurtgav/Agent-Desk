import type { ReactNode } from 'react'
import { ArrowUp, Layers, LoaderCircle, ShieldCheck, Square, Zap } from 'lucide-react'
import { EFFORTS } from '@shared/bridge'
import { useUi } from '@/store'
import { projectName } from '@/lib/selectors'
import { ModelPicker } from '../console/ModelPicker'
import { EFFORT_LABEL, MODE_OPTIONS, modeLabel, modelLabel } from '../console/options'
import { requestNewConversation, setDraft, stopConversation } from '../console/store'
import { Button, Hint, Kbd, cn } from '../ui'
import { AdvancedToggle } from './Advanced'
import { RoleChips } from './RoleChips'
import { RolePicker } from './RolePicker'
import { Facts, ProjectChip, Setting } from './Settings'
import type { Model } from './useComposer'

/** Send for a conversation is a round arrow; for a task it is the word Add. The reason it does nothing, when it does nothing, is its tooltip. */
export function SendButton({ m }: { m: Model }) {
  const keys = 'Enter sends, Shift+Enter adds a line'
  if (m.variant === 'task') {
    return (
      <Hint label={m.blocked ?? 'Add the task (Enter)'}>
        <Button type="submit" variant="primary" size="sm" aria-disabled={m.blocked !== null} aria-busy={m.working} className="aria-disabled:opacity-40 aria-disabled:hover:bg-accent-fill aria-disabled:active:scale-100">
          Add
        </Button>
      </Hint>
    )
  }
  const what = m.variant === 'reply' ? (m.running ? 'Queue this message' : 'Send') : 'Start the conversation'
  return (
    <Hint label={m.blocked ?? `${what}. ${keys}`} side="top">
      <button
        type="submit"
        aria-label={m.variant === 'new-session' ? 'Start conversation' : 'Send message'}
        aria-disabled={m.blocked !== null}
        aria-busy={m.working}
        className="press grid size-8 flex-none place-items-center rounded-full bg-accent-fill text-white hover:bg-accent-fill-hover aria-disabled:opacity-40 aria-disabled:hover:bg-accent-fill"
      >
        {m.working ? <LoaderCircle size={16} strokeWidth={2} className="animate-spin motion-reduce:animate-none" /> : <ArrowUp size={16} strokeWidth={2} />}
      </button>
    </Hint>
  )
}

/** The choices a new session starts with, as quiet chips. */
function SessionSettings({ m }: { m: Model }) {
  const { draft } = m
  return (
    <>
      <ModelPicker value={draft.model} onChange={(model) => setDraft({ model })} />
      <Setting
        icon={Zap} name="Effort" current={draft.effort} width="w-44"
        choices={EFFORTS.map((e) => ({ id: e, label: EFFORT_LABEL[e] }))}
        onPick={(id) => {
          const effort = EFFORTS.find((e) => e === id) ?? 'high'
          setDraft({ effort })
          // A task sent to an agent runs at the effort the composer holds.
          useUi.setState({ effort })
        }}
      />
      <Setting
        icon={ShieldCheck} name="Permissions" current={draft.permissionMode} width="w-80"
        choices={MODE_OPTIONS.map((o) => ({ id: o.value, label: o.label, hint: o.hint }))}
        onPick={(id) => setDraft({ permissionMode: MODE_OPTIONS.find((o) => o.value === id)?.value ?? 'default' })}
      />
    </>
  )
}

function Picker({ m, grow = true, children }: { m: Model; grow?: boolean; children: ReactNode }) {
  return (
    <RolePicker mode={m.picker} index={m.ix} recent={m.recent} onPick={m.pickFromPicker} onClose={() => m.setPicker(null)}>
      <div className={cn('flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1', grow && 'flex-1')}>{children}</div>
    </RolePicker>
  )
}

function StopButton({ id }: { id: string }) {
  return (
    <Hint label={<>Stop this turn <Kbd>Esc</Kbd></>} side="top">
      <Button size="sm" onClick={() => void stopConversation(id)} aria-label="Stop this turn">
        <Square size={12} strokeWidth={2} aria-hidden /> Stop
      </Button>
    </Hint>
  )
}

/**
 * One line: where the session runs and who leads it, how it runs, then Advanced and the two ways to start it on the right. It wraps
 * only when the window is too narrow for all of it, so nothing is ever cut off.
 */
export function NewSessionToolbar({ m, advanced, advancedId, onAdvanced }: { m: Model; advanced: boolean; advancedId: string; onAdvanced(): void }) {
  const bg = m.background
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-0.5 gap-y-1">
      <Picker m={m} grow={false}>
        <ProjectChip cwd={m.cwd} onPick={(cwd) => cwd && setDraft({ cwd })} />
        <RoleChips variant="new-session" ids={m.ids} index={m.ix} actions={m.chips} />
      </Picker>
      <SessionSettings m={m} />
      <div className="ml-auto flex flex-none items-center gap-1.5">
        <AdvancedToggle open={advanced} controls={advancedId} onToggle={onAdvanced} />
        <Hint label={bg && !bg.ok ? bg.reason : 'Start it as a background session (claude --bg). It runs on its own and shows up in Sessions.'} side="top">
          <Button variant="quiet" size="sm" aria-disabled={m.working || (bg !== null && !bg.ok)} onClick={() => void m.runInBackground()} className="aria-disabled:opacity-50">
            <Layers size={14} strokeWidth={1.75} aria-hidden /> Run in the background
          </Button>
        </Hint>
        <SendButton m={m} />
      </div>
    </div>
  )
}

/** What the conversation was started with (facts), who this message is for, and Send. */
export function ReplyToolbar({ m }: { m: Model }) {
  const v = m.view
  return (
    <div className="mt-2.5 flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <Picker m={m}>
          {v && <Facts items={[projectName(v.info.cwd) || 'Project', modeLabel(v.info.permissionMode), v.thread.capabilities?.model ?? modelLabel(v.info.model)]} />}
          <RoleChips variant="reply" ids={m.ids} index={m.ix} actions={m.chips} />
        </Picker>
      </div>
      <div className="flex flex-none items-center gap-1.5">
        {m.running && m.convId && <StopButton id={m.convId} />}
        <SendButton m={m} />
      </div>
    </div>
  )
}

/** An ended conversation has nothing to type into: it says so and offers the two ways on. */
export function Ended({ m, onResume }: { m: Model; onResume?: () => void }) {
  const resumable = m.view?.thread.sessionId
  return (
    <div className="flex items-center gap-3">
      <p className="min-w-0 flex-1 text-[13px] text-muted">{resumable ? 'This conversation is over. Resume it to keep going.' : 'This conversation is over.'}</p>
      {resumable && onResume && (
        <Button variant="primary" onClick={onResume}>
          Resume
        </Button>
      )}
      <Button onClick={requestNewConversation}>New conversation</Button>
    </div>
  )
}
