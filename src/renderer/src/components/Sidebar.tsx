import { Plus, Search } from 'lucide-react'
import { useUi } from '@/store'
import { CollapsedRail, TOGGLE_ID } from './shell/CollapsedRail'
import { AgentsPanel } from './shell/AgentsPanel'
import { SidebarNeeds } from './shell/SidebarNeeds'
import { SidebarSessions } from './shell/SidebarSessions'
import { WorkspaceRow } from './shell/WorkspaceRow'
import { newSession } from './shell/actions'
import { SidebarFooter } from './SidebarFooter'
import { Switcher } from './Switcher'
import { Button, Hint, IconButton } from './ui'

/** Collapse and Expand are different buttons in different places; keep focus on whichever now exists. */
function toggleAndKeepFocus(toggle: () => void): void {
  toggle()
  requestAnimationFrame(() => document.getElementById(TOGGLE_ID)?.focus())
}

/**
 * The same on every page (IA § 3), top to bottom: New session and Search; what needs you (only when something does); the sessions
 * AgentDeck knows, started here or watched; every agent, by team; the workspace pages as one row of icons; usage and you.
 * The two lists scroll on their own, so nothing below them is ever pushed out of the window.
 */
export function Sidebar() {
  const collapsed = useUi((s) => s.sidebarCollapsed)
  const toggle = useUi((s) => s.toggleSidebar)
  const openPalette = useUi((s) => s.setPalette)
  if (collapsed) return <CollapsedRail onExpand={() => toggleAndKeepFocus(toggle)} />

  return (
    <aside id="sidebar" aria-label="Sidebar" className="flex h-full w-[272px] flex-none flex-col bg-ground">
      <div className="app-drag traffic-inset flex h-12 flex-none items-center px-2.5">
        <Switcher collapsed={false} />
      </div>

      <div className="flex flex-none gap-2 px-2.5 pt-1">
        <Button variant="primary" aria-keyshortcuts="Control+N" className="flex-1 justify-start" onClick={newSession}>
          <Plus size={16} strokeWidth={2} aria-hidden />
          New session
          <span aria-hidden className="ml-auto text-[12px] font-normal opacity-80">
            Ctrl N
          </span>
        </Button>
        <Hint label="Search (Ctrl K)">
          <IconButton aria-label="Search" aria-keyshortcuts="Control+K" className="border border-control bg-surface" onClick={() => openPalette(true)}>
            <Search size={15} strokeWidth={1.75} />
          </IconButton>
        </Hint>
      </div>

      <SidebarNeeds />
      <SidebarSessions />
      <AgentsPanel />
      <WorkspaceRow />
      <SidebarFooter onCollapse={() => toggleAndKeepFocus(toggle)} />
    </aside>
  )
}
