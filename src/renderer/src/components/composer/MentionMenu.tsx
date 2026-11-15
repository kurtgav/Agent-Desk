import { Kbd } from '../ui'
import { MentionList } from './MentionList'
import { MENTION_LIST_ID, type Menus } from './useMenus'

/** The footer line and the panel's borders, which the list leaves room for. */
const CHROME_H = 36

/**
 * The `@` menu: every agent in one listbox (pinned and recent first, then Leadership and each division with its count; ranked while a
 * handle is being typed), under a line that says how to use it. When there is nothing to list it says why, in words.
 */
export function MentionMenu({ menus, ready, full, room, onPick }: { menus: Menus; ready: boolean; full: boolean; room: number; onPick(i: number): void }) {
  const { rows, options } = menus.mention
  return (
    <div className="overflow-hidden rounded-tile border border-line bg-overlay text-[13px] shadow-pop">
      {options.length > 0 ? (
        <MentionList rows={rows} active={menus.index} listId={MENTION_LIST_ID} label="Agents" room={room - CHROME_H} onActive={menus.setActive} onPick={onPick} />
      ) : (
        <p className="px-3 py-3 text-muted">{ready ? 'No agent matches. Keep typing, or press Esc to leave it as text.' : 'Reading the agents…'}</p>
      )}
      {(options.length > 0 || full) && (
        <p className="t-meta flex items-center gap-3 border-t border-rule px-3 py-1.5 text-muted">
          {full ? (
            <span>A lead and four helpers is the most. Take one out to add another.</span>
          ) : (
            <>
              <span>
                <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
              </span>
              <span>
                <Kbd>Enter</Kbd> or <Kbd>Tab</Kbd> adds
              </span>
              <span>
                <Kbd>Esc</Kbd> closes
              </span>
            </>
          )}
        </p>
      )}
    </div>
  )
}
