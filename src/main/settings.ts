import { userInfo } from 'node:os'
import { app, dialog, type OpenDialogOptions } from 'electron'
import { IPC } from '@shared/bridge'
import type { AppSettings, Diagnostics, Profile, ProfileResult } from '@shared/work'
import { avatarStore, AVATAR_EXTENSIONS } from './avatar'
import { readConfig, updateConfig } from './config'
import type { Dispose, MainCtx } from './ctx'
import { collectDiagnostics } from './diagnostics'
import { changeTheme, effectiveChoice } from './theme'
import { configPatch, defaultName, loginItem, parsePatch, profileName, readLogsOn, readSettings, wasWritten, weeklyBudget } from './settings-model'

function osAccount(): string | null {
  try {
    return userInfo().username
  } catch {
    return null // no account record (a service account, a sandbox): the default name applies
  }
}

/**
 * Settings, the profile (name and photo) and Diagnostics: IPC handlers over config.json and `<userData>/profile`.
 * Every value from the renderer is checked by `parsePatch`; keys this version does not know stay in config.json.
 */
export function registerSettings(ctx: MainCtx): Dispose {
  const avatar = avatarStore(ctx.userData())
  const fallbackName = (): string => defaultName(osAccount(), ctx.demo())
  // Dev builds never register a login item (ADR-0012): the choice is only stored. Windows matches an item by its arguments,
  // so "start minimized" (the --hidden argument) is asked about as well, or it would read as off.
  const openAtLogin = (): boolean | null =>
    app.isPackaged ? app.getLoginItemSettings().openAtLogin || app.getLoginItemSettings({ args: loginItem(true, true).args }).openAtLogin : null

  async function settings(): Promise<AppSettings> {
    const read = readSettings(readConfig(ctx.configFile()), { fallbackName: fallbackName(), hasAvatar: (await avatar.read()) !== null, openAtLogin: openAtLogin() })
    return { ...read, theme: effectiveChoice(read.theme) }
  }

  async function profile(): Promise<Profile> {
    return { name: profileName(readConfig(ctx.configFile()), fallbackName()), avatar: await avatar.read() }
  }

  async function update(raw: unknown): Promise<AppSettings> {
    const patch = parsePatch(raw)
    const before = await settings()
    const changes = configPatch(readConfig(ctx.configFile()), patch)
    updateConfig(ctx.configFile(), changes)
    if (!wasWritten(changes, readConfig(ctx.configFile()))) {
      throw new Error('AgentDeck could not write config.json. Check that its folder is not read-only, then try again.')
    }
    // The Usage card's bar lives in the collector's snapshot; the collector gets the new budget now and again after a restart.
    if (patch.usage?.weeklyBudgetUsd !== undefined) ctx.collector()?.post({ type: 'usageBudget', weeklyBudgetUsd: weeklyBudget(readConfig(ctx.configFile())) })
    // The log reader starts and stops with this switch (ADR-0009 amendment); a restarted collector gets the latest value again.
    if (patch.usage?.readLogs !== undefined) ctx.collector()?.post({ type: 'usageLogs', on: readLogsOn(readConfig(ctx.configFile())) })
    if (patch.theme !== undefined) changeTheme(patch.theme)
    if (app.isPackaged && (patch.startAtLogin !== undefined || patch.startMinimized !== undefined)) {
      // From what Windows said before this change plus the patch: asking Windows again now would return the old answer.
      app.setLoginItemSettings(loginItem(patch.startAtLogin ?? before.startAtLogin, patch.startMinimized ?? before.startMinimized))
    }
    return settings()
  }

  async function chooseAvatar(): Promise<ProfileResult> {
    const opts: OpenDialogOptions = {
      title: 'Choose a profile photo',
      properties: ['openFile'],
      filters: [{ name: 'Pictures', extensions: [...AVATAR_EXTENSIONS] }]
    }
    const win = ctx.window()
    const picked = win && !win.isDestroyed() ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const file = picked.canceled ? undefined : picked.filePaths[0]
    if (!file) return { ok: false, cancelled: true, error: '' }
    const saved = await avatar.save(file)
    return saved.ok ? { ok: true, profile: await profile() } : { ok: false, cancelled: false, error: saved.error }
  }

  async function clearAvatar(): Promise<Profile> {
    await avatar.clear()
    return profile()
  }

  function diagnostics(): Promise<Diagnostics> {
    return collectDiagnostics({
      demo: ctx.demo(),
      collectorRunning: ctx.collector() !== null,
      userData: ctx.userData(),
      configFile: ctx.configFile(),
      appVersion: app.getVersion()
    })
  }

  ctx.handle(IPC.getSettings, settings)
  ctx.handle(IPC.updateSettings, (_e, patch) => update(patch))
  ctx.handle(IPC.getProfile, profile)
  ctx.handle(IPC.chooseAvatar, chooseAvatar)
  ctx.handle(IPC.clearAvatar, clearAvatar)
  ctx.handle(IPC.getDiagnostics, diagnostics)
  return () => {}
}
