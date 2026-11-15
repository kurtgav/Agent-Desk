import type { ReactNode } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { Check, FolderSearch } from 'lucide-react'
import { useUi } from '@/store'
import { pickFolder } from '@/lib/act'
import { projectName, recentProjects } from '@/lib/selectors'
import { Hint, menuItem, menuLabel, menuPanel, menuSeparator } from '../ui'
import { pathKey } from '@shared/paths'

/**
 * The composer's project menu (recent project folders from the snapshot, then Browse…) around any trigger. `current`
 * is checked; `none` adds a "No project" choice. Browse… uses the folder dialog, which in demo says nothing was opened.
 */
export function ProjectMenu({ current, none = false, hint, onPick, children }: { current: string | null; none?: boolean; hint?: string; onPick(cwd: string | null): void; children: ReactNode }) {
  const snapshot = useUi((s) => s.snapshot)
  const recent = recentProjects(snapshot, 8)
  const choices = current && !recent.some((p) => pathKey(p.cwd) === pathKey(current)) ? [{ cwd: current, name: projectName(current) }, ...recent] : recent
  return (
    <Menu.Root>
      {hint ? (
        <Hint label={hint}>
          <Menu.Trigger asChild>{children}</Menu.Trigger>
        </Hint>
      ) : (
        <Menu.Trigger asChild>{children}</Menu.Trigger>
      )}
      <Menu.Portal>
        <Menu.Content align="start" sideOffset={6} className={menuPanel}>
          <Menu.Label className={menuLabel}>Project</Menu.Label>
          {none && (
            <Menu.Item className={menuItem} onSelect={() => onPick(null)}>
              <Check size={14} className={current === null ? '' : 'invisible'} />
              <span>No project</span>
            </Menu.Item>
          )}
          {choices.map((p) => (
            <Menu.Item key={p.cwd} className={menuItem} onSelect={() => onPick(p.cwd)}>
              <Check size={14} className={current && pathKey(p.cwd) === pathKey(current) ? '' : 'invisible'} />
              <span>{p.name}</span>
              <span className="ml-auto max-w-40 truncate pl-3 text-[12px] text-muted">{p.cwd}</span>
            </Menu.Item>
          ))}
          <Menu.Separator className={menuSeparator} />
          <Menu.Item className={menuItem} onSelect={() => void pickFolder().then((dir) => dir && onPick(dir))}>
            <FolderSearch size={14} strokeWidth={1.75} />
            Browse…
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}
