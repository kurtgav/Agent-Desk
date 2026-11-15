import { useEffect } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { connect, useUi } from './store'
import { Frame } from './components/shell/Frame'
import { SessionMenuDialogs } from './components/session-menu/Dialogs'
import { Notice } from './components/Notice'
import { Palette } from './components/Palette'

const TICK_MS = 30_000

export function App() {
  const announcement = useUi((s) => s.announcement)

  useEffect(() => {
    const id = setInterval(() => useUi.getState().tick(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => connect(), [])

  return (
    <Tooltip.Provider delayDuration={300}>
      <Frame />
      <SessionMenuDialogs />
      <Palette />
      <Notice />
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </Tooltip.Provider>
  )
}
