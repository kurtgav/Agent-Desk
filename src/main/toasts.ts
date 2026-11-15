import { join } from 'node:path'
import { Notification, nativeImage, type NativeImage } from 'electron'
import { IPC, type ActionResult } from '@shared/bridge'
import type { Dispose, MainCtx } from './ctx'
import { TEST_TOAST, TEST_TOAST_WAIT_MS, showAndWait, testToastResult, toastOptions, type ToastText } from './notify'
import { showWindow } from './window'

// Same place as RESOURCES in index.ts: out/main -> project root (dev) or app.asar root (packaged).
const BOT_ICON = join(__dirname, '../../resources/agent-bot.png')

let bot: NativeImage | undefined

/** The mascot (docs/images/agent-bot.webp as a PNG: nativeImage cannot decode WebP), decoded once. */
function botIcon(): NativeImage {
  if (!bot || bot.isEmpty()) bot = nativeImage.createFromPath(BOT_ICON)
  return bot
}

/**
 * The only place a toast is made: every one carries the bot image (see `toastOptions`).
 * Windows attributes a toast to the AppUserModelID set in index.ts. A packaged build has the installer's Start-menu
 * shortcut for it, so the header reads "AgentDeck". A dev `electron.exe` has none, so Windows shows its own default
 * name there (and may hide the toast, R19); the bot image is still the toast's picture. macOS names a notification by the
 * app bundle and shows its icon, not `icon`, and asks the user once whether AgentDeck may notify.
 */
export const createToast = (text: ToastText): Notification => new Notification(toastOptions(text, botIcon()))

/** Settings > Notifications > "Send a test notification": a real toast now, and whether Windows took it. */
export function registerToasts(ctx: MainCtx): Dispose {
  // Kept referenced so a click from the Action Center still reaches us.
  let last: Notification | undefined
  ctx.handle(IPC.testNotification, async (): Promise<ActionResult> => {
    if (!Notification.isSupported()) return testToastResult({ kind: 'unsupported' })
    last?.close()
    const n = createToast(TEST_TOAST)
    n.on('click', () => {
      const w = ctx.window()
      if (w) showWindow(w)
    })
    last = n
    return testToastResult(await showAndWait(n, TEST_TOAST_WAIT_MS))
  })
  return () => last?.close()
}
