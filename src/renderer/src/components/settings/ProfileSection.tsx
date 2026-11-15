import { useState, type KeyboardEvent } from 'react'
import { PROFILE_NAME_MAX, type ProfileResult } from '@shared/work'
import { useUi } from '@/store'
import { UserAvatar } from '../UserAvatar'
import { Button, cn } from '../ui'
import { FIELD, Section } from './Section'
import { plainError, type SettingsApi } from './useSettings'

/** Settings › Profile: a header with the photo and the name beside it; the name saves when you leave the field or press Enter. */
export function ProfileSection({ api }: { api: SettingsApi }) {
  const { settings, save, markSaved, setError, savedSection, errors } = api
  const hasPhoto = useUi((s) => s.profile.avatar !== null)
  const setProfile = useUi((s) => s.setProfile)
  const [busy, setBusy] = useState(false)
  const stored = settings.profile.name

  async function changePhoto(): Promise<void> {
    if (!window.agentdeck) return
    setBusy(true)
    setError('profile', null)
    const r: ProfileResult = await window.agentdeck.chooseAvatar().catch((e: unknown) => ({ ok: false as const, cancelled: false, error: plainError(e) }))
    setBusy(false)
    if (r.ok) {
      setProfile(r.profile)
      markSaved('profile')
    } else if (!r.cancelled) {
      setError('profile', r.error)
    }
  }

  async function removePhoto(): Promise<void> {
    if (!window.agentdeck) return
    setError('profile', null)
    try {
      setProfile(await window.agentdeck.clearAvatar())
      markSaved('profile')
      // Remove is gone now; keep keyboard focus in the row.
      requestAnimationFrame(() => document.getElementById('profile-photo')?.focus())
    } catch (e) {
      setError('profile', plainError(e))
    }
  }

  function leave(input: HTMLInputElement): void {
    const next = input.value.trim()
    if (next === stored) {
      input.value = stored
      return
    }
    void save('profile', { profileName: next })
  }

  function keys(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') e.currentTarget.blur()
    if (e.key === 'Escape') {
      e.currentTarget.value = stored
      e.currentTarget.blur()
    }
  }

  return (
    <Section id="profile" title="Profile" description="How AgentDeck greets you. Everything here stays on this PC." saved={savedSection === 'profile'} error={errors.profile}>
      <div className="flex items-start gap-6 border-t border-rule px-4 py-5">
        <UserAvatar size={88} />
        <div className="min-w-0 flex-1">
          <label htmlFor="profile-name" className="block text-[14px] font-medium leading-5">
            Name
          </label>
          <input
            id="profile-name"
            // Remounted whenever main stores a different name, so the field always shows what is saved.
            key={stored}
            defaultValue={stored}
            maxLength={PROFILE_NAME_MAX}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="profile-name-help"
            onBlur={(e) => leave(e.currentTarget)}
            onKeyDown={keys}
            className={cn(FIELD, 'mt-1.5 w-full max-w-sm')}
          />
          <p id="profile-name-help" className="mt-1.5 text-pretty text-[12px] leading-4 text-muted">
            Shown in the greeting and the sidebar. Leave it empty to use your account name on this computer.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button id="profile-photo" size="sm" onClick={() => void changePhoto()} disabled={busy}>
              {busy ? 'Choosing…' : hasPhoto ? 'Change photo' : 'Add photo'}
            </Button>
            {hasPhoto && (
              <Button variant="ghost" size="sm" className="text-[var(--failed-ink)] hover:bg-[var(--failed-bg)]" onClick={() => void removePhoto()}>
                Remove
              </Button>
            )}
            <p className="text-pretty text-[12px] leading-4 text-muted">PNG or JPEG up to 10 MB, cropped to a square.</p>
          </div>
        </div>
      </div>
    </Section>
  )
}
