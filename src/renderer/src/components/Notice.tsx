import { useEffect, useState } from 'react'
import { useUi } from '@/store'
import { cn } from './ui'

const SHOW_MS = { ok: 4_000, error: 8_000 } as const

/** The outcome of an action ("Copied…", "VS Code's code command is not on PATH"), at the bottom of the window. */
export function Notice() {
  const notice = useUi((s) => s.notice)
  const [hidden, setHidden] = useState(0)
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setHidden(notice.at), SHOW_MS[notice.tone])
    return () => clearTimeout(t)
  }, [notice])
  const shown = notice !== null && notice.at !== hidden
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex justify-center px-6">
      <div
        data-testid="notice"
        role={notice?.tone === 'error' ? 'alert' : 'status'}
        className={cn(
          'max-w-[60ch] rounded-full px-4 py-2 text-[13px] shadow-[0_8px_24px_rgb(0_0_0/0.16)] transition-[opacity,translate] duration-200 ease-out motion-reduce:transition-none',
          notice?.tone === 'error' ? 'bg-[var(--failed-ink)] text-white' : 'bg-ink text-white',
          shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
        )}
      >
        {shown ? notice.text : ''}
      </div>
    </div>
  )
}
