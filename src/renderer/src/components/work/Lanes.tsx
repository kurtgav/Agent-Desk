import type { ReactNode } from 'react'
import { CountBadge, cn } from '../ui'
import { StateNote } from '../pages/kit'
import { useUi } from '@/store'
import { isPinned } from '@/lib/sessionMeta'
import { asksNow, itemKey, type LaneItem, type Lanes as LaneData } from '@/lib/work'
import { AgentRow } from './AgentRow'
import type { Untrusted } from './sendTask'
import { TaskRow } from './TaskRow'

interface LaneProps {
  id: string
  title: string
  count: number | undefined
  /** The status colour of the lane's dot: the lane says where its cards are in their life. */
  dot: string
  /** The lane the page is about: a firmer border and its count in the working colours. */
  focal?: boolean
  /** The count reads in the needs colours: something in the lane asks for you now. */
  urgent?: boolean
  empty: [title: string, text: string]
  loading: boolean
  children: ReactNode
}

/** One lane: a dot, its title and count, then its cards, or a sentence about what the lane is for when it is empty. */
function Lane({ id, title, count, dot, focal, urgent, empty, loading, children }: LaneProps) {
  return (
    <section aria-labelledby={id} className={cn('rounded-card border bg-surface', focal ? 'border-control' : 'border-line')}>
      <header className="flex h-[52px] items-center gap-2 px-4">
        <span aria-hidden className="size-2 flex-none rounded-full" style={{ background: dot }} />
        <h2 id={id} className="t-title">
          {title}
        </h2>
        {count !== undefined &&
          (focal ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[12px] font-medium tabular-nums" style={{ background: 'var(--working-bg)', color: 'var(--working-ink)' }}>
              {count}
              <span className="sr-only"> items</span>
            </span>
          ) : (
            <CountBadge n={count} label="items" tone={urgent && count > 0 ? 'needs' : 'neutral'} />
          ))}
      </header>
      {count ? (
        <ul aria-labelledby={id}>{children}</ul>
      ) : loading ? (
        <StateNote tone="loading" divided>
          Reading your tasks…
        </StateNote>
      ) : (
        <StateNote title={empty[0]} divided>
          {empty[1]}
        </StateNote>
      )}
    </section>
  )
}

function Rows({ items, now, onTrust, pinFirst = true }: { items: readonly LaneItem[]; now: number; onTrust(t: Untrusted): void; pinFirst?: boolean }) {
  const meta = useUi((s) => s.sessionMeta)
  // A pinned agent session floats to the top of its lane; every other order stays. Waiting on you keeps its urgency order.
  const pinned = (i: LaneItem): boolean => pinFirst && i.kind === 'agent' && isPinned(meta, i.session.id)
  return [...items.filter(pinned), ...items.filter((i) => !pinned(i))].map((i) =>
    i.kind === 'task' ? <TaskRow key={itemKey(i)} item={i} now={now} onTrust={onTrust} /> : <AgentRow key={itemKey(i)} session={i.session} now={now} reason={i.reason} />
  )
}

/**
 * To do, In progress, Waiting on you, Done today: what nobody started, what runs, what waits on you, what finished. In
 * progress is the focal lane: where your started tasks and the agents working right now meet. Waiting on you holds the
 * sessions that wait on you (an approval, a question, a failed or stuck run), so In progress only shows work that is
 * moving. Two lanes a row from 960 px, all four from 1360 px; each keeps its own height.
 */
export function Lanes({ lanes, now, loading, onTrust }: { lanes: LaneData; now: number; loading: boolean; onTrust(t: Untrusted): void }) {
  return (
    <div className="grid items-start gap-4 min-[960px]:grid-cols-2 min-[1360px]:grid-cols-4">
      <Lane
        id="lane-todo"
        title="To do"
        dot="var(--idle)"
        count={loading ? undefined : lanes.todo.length}
        loading={loading}
        empty={['Nothing to do', 'Things you want done, nothing started yet. Type a task above and press Enter.']}
      >
        <Rows items={lanes.todo} now={now} onTrust={onTrust} />
      </Lane>
      <Lane
        id="lane-doing"
        title="In progress"
        dot="var(--working)"
        focal
        count={loading ? undefined : lanes.doing.length}
        loading={loading}
        empty={['Nothing in progress', 'Tasks you started and agents working right now. Press Start on a task, or send it to an agent.']}
      >
        <Rows items={lanes.doing} now={now} onTrust={onTrust} />
      </Lane>
      <Lane
        id="lane-needs"
        title="Waiting on you"
        dot="var(--needs)"
        urgent={lanes.needs.some(asksNow)}
        count={loading ? undefined : lanes.needs.length}
        loading={loading}
        empty={['Nothing waiting on you', 'Approvals, questions, failed and stuck sessions land here, the most urgent on top.']}
      >
        <Rows items={lanes.needs} now={now} onTrust={onTrust} pinFirst={false} />
      </Lane>
      <Lane
        id="lane-done"
        title="Done today"
        dot="var(--done)"
        count={loading ? undefined : lanes.done.length}
        loading={loading}
        empty={['Nothing done yet', 'Tasks you finish and agent sessions that end today land here.']}
      >
        <Rows items={lanes.done} now={now} onTrust={onTrust} />
      </Lane>
    </div>
  )
}
