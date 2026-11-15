import { Composer } from '../composer/Composer'
import { resumeConversation } from '../console/store'

/**
 * The one place a composer is mounted by the shell: the shared `Composer` (components/composer), in the variant the place needs.
 *
 *   variant "new"   the new session screen: its own card, with the suggested agents under it and Advanced inside it.
 *   variant "reply" the bottom of a session started here: a bar with the message box for that conversation (or Resume, once it ended).
 */
export function ComposerSlot({ variant, conv }: { variant: 'new' | 'reply'; conv?: string | null }) {
  if (variant === 'new') return <Composer />
  if (!conv) return null
  return (
    <div className="border-t border-line bg-surface px-5 pb-3 pt-3">
      <Composer variant="reply" conversationId={conv} onResume={() => resumeConversation(conv)} />
    </div>
  )
}
