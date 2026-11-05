import { ChevronRight, FileCode, FileText } from 'lucide-react'
import type { ChangedFile, Session } from '@shared/snapshot'
import { useUi } from '@/store'
import { openChangedFile } from '@/lib/act'
import { ago } from '@/lib/format'
import { projectName, sessionIndex } from '@/lib/selectors'
import { Button, Card, CardHeader, Hint } from './ui'

const MAX_ROWS = 4
const CODE = /\.(tsx?|jsx?|mjs|cjs|css|json|py|go|rs|cs|java|sql|ya?ml|toml|sh|ps1)$/i

/** One changed file: a click opens it in VS Code (`code -g`). Also the Files page's row. */
export function FileRow({ file, session, now }: { file: ChangedFile; session: Session | undefined; now: number }) {
  const Icon = CODE.test(file.path) ? FileCode : FileText
  return (
    <li className="border-t border-rule">
      <Hint label={`Open in VS Code: ${file.path}`}>
        <button type="button" onClick={() => void openChangedFile(file.path)} className="flex h-[57px] w-full items-center gap-3 px-4 text-left transition-[background-color] duration-150 hover:bg-ground">
          <span className="grid size-8 flex-none place-items-center rounded-lg bg-well" aria-hidden>
            <Icon size={15} strokeWidth={1.75} className="text-muted" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] leading-5" title={file.path}>
              {projectName(file.path)}
            </span>
            <span className="block truncate text-[12px] leading-4 text-muted">
              {session ? `${projectName(session.cwd)} · ${session.name}` : file.tool} · {ago(now - file.changedAt)}
            </span>
          </span>
          <ChevronRight size={16} strokeWidth={1.75} className="flex-none text-muted" aria-hidden />
        </button>
      </Hint>
    </li>
  )
}

/** Newest change per path (D-013: case-insensitive), files already sorted newest first. */
export function latestPerPath(files: readonly ChangedFile[], max: number): ChangedFile[] {
  const seen = new Set<string>()
  const out: ChangedFile[] = []
  for (const f of files) {
    const key = f.path.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(f)
    if (out.length === max) break
  }
  return out
}

export function RecentFiles() {
  const snapshot = useUi((s) => s.snapshot)
  const now = useUi((s) => s.now)
  const sessions = sessionIndex(snapshot)
  const files = latestPerPath(snapshot.files, MAX_ROWS)
  const go = useUi((s) => s.go)
  return (
    <Card aria-labelledby="recent-files">
      <CardHeader
        id="recent-files"
        title="Recent files"
        action={
          <Button variant="ghost" size="sm" onClick={() => go({ page: 'files' })}>
            See all
          </Button>
        }
      />
      {files.length ? (
        <ul>
          {files.map((f) => (
            <FileRow key={f.path} file={f} session={sessions.get(f.sessionId)} now={now} />
          ))}
        </ul>
      ) : (
        <p className="border-t border-rule px-4 py-6 text-[13px] text-muted">No files changed this week.</p>
      )}
    </Card>
  )
}
