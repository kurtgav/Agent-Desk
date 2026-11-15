import { Pin } from 'lucide-react'
import { useNote } from './hooks'

/** After a session's name in any list: a pin when it is pinned, a small accent dot while it is marked unread. Said in words for a screen reader. */
export function Marks({ id }: { id: string }) {
  const note = useNote(id)
  if (!note?.pinned && !note?.unread) return null
  return (
    <span className="ml-1.5 inline-flex flex-none items-center gap-1 align-middle">
      {note.pinned && <Pin size={12} strokeWidth={1.75} className="text-muted" role="img" aria-label="Pinned" />}
      {note.unread && (
        <>
          <span aria-hidden className="size-2 rounded-full bg-accent" />
          <span className="sr-only">Unread</span>
        </>
      )}
    </span>
  )
}
