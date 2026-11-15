import { useState } from 'react'
import { ChevronRight, FileCode, FileText } from 'lucide-react'
import { SNAPSHOT_FILES_MAX, type ChangedFile, type Session } from '@shared/snapshot'
import { pathKey } from '@shared/paths'
import { useUi } from '@/store'
import { openChangedFile } from '@/lib/act'
import { ago } from '@/lib/format'
import { projectName, sessionIndex } from '@/lib/selectors'
import { latestPerPath } from '../RecentFiles'
import { Card, CardHeader, Hint } from '../ui'
import { PageFrame, SearchBox } from './Page'
import { ListCard, ResultCount, StateNote } from './kit'
import { splitPath } from './rows'

const CODE = /\.(tsx?|jsx?|mjs|cjs|css|json|py|go|rs|cs|java|sql|ya?ml|toml|sh|ps1)$/i
/** File and its folder, who changed it, when: every row shares this grid. */
const GRID = 'grid grid-cols-[minmax(0,1fr)_minmax(0,0.32fr)_88px_16px]'

/** One changed file: a click opens it in VS Code (`code -g`), as on Home. */
function FileLine({ file, session, now }: { file: ChangedFile; session: Session | undefined; now: number }) {
  const Icon = CODE.test(file.path) ? FileCode : FileText
  const { dir, name } = splitPath(file.path, session?.cwd ?? '')
  return (
    <li className="border-t border-rule px-2 py-0.5">
      <Hint label={`Open in VS Code: ${file.path}`}>
        <button
          type="button"
          onClick={() => void openChangedFile(file.path)}
          className={`${GRID} group w-full items-center gap-x-4 rounded-lg px-2 py-1.5 text-left outline-none transition-[background-color] duration-150 hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent`}
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="grid size-7 flex-none place-items-center rounded-lg bg-well" aria-hidden>
              <Icon size={14} strokeWidth={1.75} className="text-muted" />
            </span>
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="flex-none text-[14px] font-medium leading-5">{name}</span>
              {dir && <span className="truncate text-[12px] leading-5 text-muted">{dir}</span>}
            </span>
          </span>
          <span className="truncate text-[13px] text-muted">{session?.name ?? file.tool}</span>
          <span className="text-[12px] tabular-nums text-muted">{ago(now - file.changedAt)}</span>
          <ChevronRight size={14} strokeWidth={1.75} className="text-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
        </button>
      </Hint>
    </li>
  )
}

/** UI_MAP § Sidebar › Files: this week's changed files, grouped by the project of the session that changed them. */
export function FilesPage() {
  const snapshot = useUi((s) => s.snapshot)
  const now = useUi((s) => s.now)
  const [q, setQ] = useState('')
  const sessions = sessionIndex(snapshot)
  const needle = q.trim().toLowerCase()
  const files = latestPerPath(snapshot.files, Infinity).filter((f) => !needle || f.path.toLowerCase().includes(needle))
  const groups = new Map<string, { name: string; cwd: string; files: ChangedFile[] }>()
  for (const f of files) {
    const cwd = sessions.get(f.sessionId)?.cwd ?? ''
    const key = cwd ? pathKey(cwd) : ''
    const g = groups.get(key) ?? { name: cwd ? projectName(cwd) : 'Session no longer listed', cwd, files: [] }
    g.files.push(f)
    groups.set(key, g)
  }
  return (
    <PageFrame
      page="files"
      lede={`Files your agents changed this week, the newest ${SNAPSHOT_FILES_MAX}. Click one to open it in VS Code.`}
      filters={
        <>
          <SearchBox label="Filter by path" value={q} onChange={setQ} />
          {files.length > 0 && <ResultCount n={files.length} one="file" many="files" />}
        </>
      }
    >
      {groups.size ? (
        // Ids by position: a folder name can hold spaces, which aria-labelledby would split.
        [...groups].map(([key, g], i) => (
          <Card key={key} aria-labelledby={`files-${i}`}>
            <CardHeader
              id={`files-${i}`}
              title={g.name}
              count={g.files.length}
              countLabel="files"
              action={g.cwd && <span className="block max-w-[52ch] truncate text-[12px] font-normal text-muted" title={g.cwd}>{g.cwd}</span>}
            />
            <ul className="pb-1">
              {g.files.map((f) => (
                <FileLine key={f.path} file={f} session={sessions.get(f.sessionId)} now={now} />
              ))}
            </ul>
          </Card>
        ))
      ) : (
        <ListCard label="Files">
          <StateNote title={snapshot.files.length ? 'No file path matches' : 'No files changed this week'}>
            {snapshot.files.length ? 'Try a shorter part of the path.' : 'Files your agents write or edit show up here, grouped by project.'}
          </StateNote>
        </ListCard>
      )}
    </PageFrame>
  )
}
