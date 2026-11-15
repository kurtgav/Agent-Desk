import { useEffect, useState } from 'react'
import { CircleAlert, CircleCheck } from 'lucide-react'
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
  const Icon = notice?.tone === 'error' ? CircleAlert : CircleCheck
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex justify-center px-6">
      <div
        data-testid="notice"
        role={notice?.tone === 'error' ? 'alert' : 'status'}
        className={cn(
          'flex max-w-[60ch] items-start gap-2 rounded-tile px-3.5 py-2.5 text-[13px] leading-5 text-on-tip shadow-modal transition-[opacity,translate] duration-200 motion-reduce:transition-none',
          notice?.tone === 'error' ? 'bg-[var(--failed-solid)]' : 'bg-tip',
          shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
        )}
      >
        {/* Not colour alone: the icon says which kind it is. */}
        {shown && <Icon size={16} strokeWidth={1.75} className="mt-0.5 flex-none" aria-hidden />}
        <span className="min-w-0 [overflow-wrap:anywhere]">{shown ? notice.text : ''}</span>
      </div>
    </div>
  )
}
