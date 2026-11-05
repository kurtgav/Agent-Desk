import { useState } from 'react'
import { SNAPSHOT_FILES_MAX, type ChangedFile } from '@shared/snapshot'
import { pathKey } from '@shared/paths'
import { useUi } from '@/store'
import { projectName, sessionIndex } from '@/lib/selectors'
import { FileRow, latestPerPath } from '../RecentFiles'
import { Card, CardHeader } from '../ui'
import { Empty, PageFrame, SearchBox } from './Page'

/** UI_MAP § Sidebar › Files: this week's changed files, grouped by the project of the session that changed them. */
export function FilesPage() {
  const snapshot = useUi((s) => s.snapshot)
  const now = useUi((s) => s.now)
  const [q, setQ] = useState('')
  const sessions = sessionIndex(snapshot)
  const needle = q.trim().toLowerCase()
  const files = latestPerPath(snapshot.files, Infinity).filter((f) => !needle || f.path.toLowerCase().includes(needle))
  const groups = new Map<string, { name: string; files: ChangedFile[] }>()
  for (const f of files) {
    const cwd = sessions.get(f.sessionId)?.cwd ?? ''
    const key = cwd ? pathKey(cwd) : ''
    const g = groups.get(key) ?? { name: cwd ? projectName(cwd) : 'Session no longer listed', files: [] }
    g.files.push(f)
    groups.set(key, g)
  }
  return (
    <PageFrame page="files" lede={`Files your agents changed this week, the newest ${SNAPSHOT_FILES_MAX}. Click one to open it in VS Code.`}>
      <div>
        <SearchBox label="Filter by path" value={q} onChange={setQ} />
      </div>
      {groups.size ? (
        // Ids by position: a folder name can hold spaces, which aria-labelledby would split.
        [...groups].map(([key, g], i) => (
          <Card key={key} aria-labelledby={`files-${i}`}>
            <CardHeader id={`files-${i}`} title={g.name} count={g.files.length} countLabel="files" />
            <ul>
              {g.files.map((f) => (
                <FileRow key={f.path} file={f} session={sessions.get(f.sessionId)} now={now} />
              ))}
            </ul>
          </Card>
        ))
      ) : (
        <Card>
          <Empty>{snapshot.files.length ? 'No file path matches.' : 'No files changed this week.'}</Empty>
        </Card>
      )}
    </PageFrame>
  )
}
