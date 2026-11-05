import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  app, clipboard, dialog, ipcMain, Menu, session, type BrowserWindow, type IpcMainInvokeEvent, type OpenDialogOptions, type Tray
} from 'electron'
import { z } from 'zod'
import {
  EFFORTS, IPC, PROMPT_MAX, type ActionResult, type AgentDef, type AppInfo, type AppStatus, type DispatchResult, type HooksPreview, type HooksResult,
  type RemoteApprovals
} from '@shared/bridge'
import type { FromCollector } from '@shared/collector'
import type { SessionDetail } from '@shared/detail'
import type { Session, Snapshot } from '@shared/snapshot'
import { resolveClaude } from '../collector/cli'
import { act, LOCAL_PATH, logs, openFile, runClaudeIn, type ActionDeps } from './actions'
import { agentList } from './agents'
import { isAppUrl } from './app-url'
import { superviseCollector, type Supervisor } from './collector'
import { readConfig, remoteApprovals, updateConfig } from './config'
import { NOT_KNOWN, dispatch, knownFolder, refusal } from './dispatch'
import { hookOptions, hooksState, install, previewInstall, previewUninstall, shapeFor, uninstall, type HookPaths } from './hooks'
import { settingsPath, type HookTarget } from './hooks-install'
import { isPaused, notifyPrefs, tomorrowMorning, type NotifyPrefs } from './notify'
import { registerAppScheme, serveRenderer } from './protocol'
import { Signals } from './signals'
import { createTray } from './tray'
import { createMainWindow, showWindow } from './window'
import { appTitle } from './window-options'

// out/main -> project root (dev) or app.asar root (packaged); works for `electron .` and `electron out/main/index.js`.
const RESOURCES = join(__dirname, '../../resources')
const RENDERER_ROOT = join(__dirname, '../renderer')
const COLLECTOR_ENTRY = join(__dirname, 'collector.js')
/** D-001 */
const PORTS = Array.from({ length: 11 }, (_, i) => 47821 + i)

// Test isolation: must precede anything that reads userData, including the single-instance lock.
const userDataOverride = process.env.AGENTDECK_USER_DATA
if (userDataOverride) app.setPath('userData', userDataOverride)
app.setAppUserModelId('com.thirdcode.agentdeck')

let win: BrowserWindow | undefined
let tray: Tray | undefined // module-level so it is not garbage-collected
let collector: Supervisor | null = null
let latest: Snapshot | null = null
let demo = false
/** The collector's bound port; our hook entries point at it. */
let port: number | null = null
let status: AppStatus | null = null
let resumeTimer: NodeJS.Timeout | undefined
const HOUR_MS = 3_600_000

const signals = new Signals({
  resources: RESOURCES,
  title: () => appTitle(demo),
  window: () => win,
  tray: () => tray,
  prefs: () => prefs(),
  // A conflict (disableAllHooks, allowedHttpHookUrls) stops our hooks as surely as missing entries do.
  hooks: () => (demo || !status ? null : status.conflicts.length ? 'error' : status.hooks),
  open: focusItem
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  registerAppScheme()
  app.on('second-instance', () => openWindow())
  app.on('window-all-closed', () => {
    // Keep running in the tray: quitting happens only from the tray menu.
  })
  app.on('will-quit', () => {
    removeHooksForQuit()
    collector?.stop()
  })
  void app.whenReady().then(start)
}

// ── Hook integration (ADR-0005) ──

function hookPaths(): HookPaths {
  return { settings: settingsPath(process.env, homedir()), backups: join(app.getPath('userData'), 'backups') }
}

const approvalsConfig = (): RemoteApprovals => remoteApprovals(readConfig(configFile()))

const target = (ra = approvalsConfig()): HookTarget | null => (port === null ? null : { port, token: hookToken(), ...hookOptions(ra) })

/**
 * The user OK'd this entry shape, for this settings.json, in the install dialog; launch then reuses that consent
 * (ADR-0005 § 4). Another CLAUDE_CONFIG_DIR is another file, so it gets its own diff and OK.
 */
function consented(): boolean {
  const c = readConfig(configFile())
  return c.hooksConsent === shapeFor(remoteApprovals(c)) && c.hooksConsentPath === hookPaths().settings
}

function prefs(): NotifyPrefs {
  return notifyPrefs(readConfig(configFile()))
}

function refreshStatus(): AppStatus {
  const p = prefs()
  const ra = approvalsConfig()
  status = { ...hooksState(hookPaths(), target(ra)), pausedUntil: isPaused(p, Date.now()) ? p.pausedUntil : null, remoteApprovals: ra }
  // ADR-0006: hold only while the entries that wait long enough are in place; otherwise Claude Code cuts in at 2 s.
  const holding = !demo && ra.enabled && status.hooks === 'installed' && consented()
  collector?.post({ type: 'approvals', enabled: holding, waitMs: ra.waitSec * 1000 })
  if (win && !win.isDestroyed()) win.webContents.send(IPC.statusPush, status)
  signals.render()
  return status
}

/** Launch, and a new port after a collector restart (R31): rewrite our entries if the user already agreed. */
function installIfConsented(): void {
  if (demo || !consented()) return
  const t = target()
  if (!t) return
  const r = install(hookPaths(), t)
  if (!r.ok) console.error(`[hooks] install: ${r.error}`)
}

/**
 * Quit (ADR-0005 § 1): with AgentDeck closed, Claude Code sees no AgentDeck hooks. The consent stays for next launch.
 * Any recorded consent counts here, not only this version's shape: entries an older version installed must go too.
 */
function removeHooksForQuit(): void {
  if (typeof readConfig(configFile()).hooksConsent !== 'string') return
  const r = uninstall(hookPaths())
  if (!r.ok) console.error(`[hooks] uninstall on quit: ${r.error}`)
}

const NOT_READY = 'AgentDeck is still starting its collector. Try again in a moment.'

/** The install dialog's choice; written to config only together with the entries it shapes. */
const withApprovals = (on: unknown): RemoteApprovals => ({ ...approvalsConfig(), enabled: z.boolean().parse(on) })

function onInstall(on: unknown): HooksResult {
  const ra = withApprovals(on)
  const t = target(ra)
  if (demo || !t) return { ok: false, error: demo ? 'Turn demo data off first.' : NOT_READY }
  const r = install(hookPaths(), t)
  if (r.ok) updateConfig(configFile(), { remoteApprovals: ra, hooksConsent: shapeFor(ra), hooksConsentPath: hookPaths().settings, hooksConsentAt: Date.now() })
  refreshStatus()
  return r
}

function onUninstall(): HooksResult {
  const r = uninstall(hookPaths())
  if (r.ok) updateConfig(configFile(), { hooksConsent: null })
  refreshStatus()
  return r
}

function onPreviewInstall(on: unknown): HooksPreview {
  const t = target(withApprovals(on))
  return t ? previewInstall(hookPaths(), t) : { ok: false, path: hookPaths().settings, error: NOT_READY }
}

/** ADR-0006: one click answers one held request. Only our page reaches this, and only through `handle`. */
async function onDecide(id: unknown, verdict: unknown): Promise<ActionResult> {
  if (demo) return DEMO_REFUSED
  const itemId = z.string().min(1).max(64).parse(id)
  const v = z.enum(['approve', 'reject']).parse(verdict)
  if (!collector) return { ok: false, error: NOT_READY }
  const m = await collector.request((reqId) => ({ type: 'decide', reqId, itemId, verdict: v }))
  return m?.type === 'decided' ? m.result : { ok: false, error: 'AgentDeck did not hear back from its collector. If the terminal asks, answer it there.' }
}

// ── Notifications ──

function setPause(choice: 'hour' | 'tomorrow' | null): void {
  const now = Date.now()
  const until = choice === 'hour' ? now + HOUR_MS : choice === 'tomorrow' ? tomorrowMorning(now) : null
  const prev = readConfig(configFile()).notifications
  updateConfig(configFile(), { notifications: { ...(typeof prev === 'object' && prev !== null ? prev : {}), pausedUntil: until } })
  clearTimeout(resumeTimer)
  // The gray tray dot and the Paused chip go away on their own when the pause runs out.
  if (until !== null) resumeTimer = setTimeout(refreshStatus, until - now)
  refreshStatus()
}

/** A toast click: bring the window up and point the renderer at the item. */
function focusItem(id: string): void {
  openWindow()
  const send = (): void => {
    if (win && !win.isDestroyed()) win.webContents.send(IPC.focusItem, id)
  }
  if (win?.webContents.isLoading()) win.webContents.once('did-finish-load', send)
  else send()
}

// ── Session actions (UI_MAP § Session drawer) ──

let claudeCli: Promise<string | null> | null = null
const actionDeps: ActionDeps = {
  // Resolved once (ADR-0008); a miss is retried on the next action, so installing Claude Code needs no restart.
  claude: () => {
    const override = readConfig(configFile()).claudePath
    claudeCli ??= resolveClaude(typeof override === 'string' ? override : undefined).then((p) => {
      if (!p) claudeCli = null
      return p
    })
    return claudeCli
  },
  copy: (text) => clipboard.writeText(text)
}

const SessionId = z.string().min(1).max(128)

async function detail(sessionId: string): Promise<SessionDetail | null> {
  if (demo || !collector) return null
  const m = await collector.request((reqId) => ({ type: 'detail', reqId, sessionId }))
  return m?.type === 'detail' ? m.detail : null
}

/** The session as the collector knows it: cwd and ids never come from the renderer. */
async function sessionFor(id: string): Promise<Session | null> {
  return latest?.sessions.find((s) => s.id === id) ?? (await detail(id))?.session ?? null
}

const UNKNOWN: ActionResult = { ok: false, error: 'AgentDeck does not know this session (any more).' }
/** The renderer already runs nothing in demo (D-094); main refuses too, in case it is asked anyway. */
const DEMO_REFUSED: ActionResult = { ok: false, error: 'Demo data: nothing was run.' }

// ── Composer (brief § Composer) ──

const configDir = (): string => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
/** Folders picked with Browse… during this run. Dispatch also takes any folder a listed session runs in. */
const picked = new Set<string>()
const knownFolders = (): string[] => [...picked, ...(latest?.sessions.map((s) => s.cwd) ?? [])]
const Folder = z.string().min(3).max(1024)

async function agentsFor(cwd: string | null): Promise<AgentDef[]> {
  if (demo) return []
  const project = cwd && (await knownFolder(cwd, knownFolders())) ? join(cwd, '.claude', 'agents') : null
  return agentList(join(configDir(), 'agents'), project)
}

const Dispatch = z.object({
  prompt: z.string().trim().min(1).max(PROMPT_MAX),
  cwd: Folder,
  agent: z.string().min(1).max(64).nullable(),
  effort: z.enum(EFFORTS)
})

async function onDispatch(raw: unknown): Promise<DispatchResult> {
  if (demo) return { ok: false, error: 'Demo data: nothing was dispatched.', untrusted: false }
  const req = Dispatch.parse(raw)
  const why = await refusal(req, knownFolders(), agentsFor)
  return why ? { ok: false, error: why, untrusted: false } : dispatch(req, actionDeps)
}

async function onChooseFolder(): Promise<string | null> {
  if (demo) return null
  const opts: OpenDialogOptions = { title: 'Run the task in this folder', properties: ['openDirectory'] }
  const r = win && !win.isDestroyed() ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  const dir = r.canceled ? undefined : r.filePaths[0]
  if (!dir) return null
  // A network folder is returned so the composer can say why it won't run there, but it never becomes "known".
  if (LOCAL_PATH.test(dir)) picked.add(dir)
  return dir
}

async function onRunClaudeIn(cwd: unknown): Promise<ActionResult> {
  if (demo) return DEMO_REFUSED
  const dir = Folder.parse(cwd)
  return (await knownFolder(dir, knownFolders())) ? runClaudeIn(dir, actionDeps) : { ok: false, error: NOT_KNOWN }
}

/** Only our own page may call into main (ADR-0010). */
function fromApp(e: IpcMainInvokeEvent): boolean {
  const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
  return isAppUrl(e.senderFrame?.url ?? '', devUrl)
}

function handle<T>(channel: string, fn: (e: IpcMainInvokeEvent, ...args: unknown[]) => T): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (!fromApp(e)) throw new Error('Not allowed')
    return fn(e, ...args)
  })
}

function configFile(): string {
  return join(app.getPath('userData'), 'config.json')
}

/** ADR-0010: 32 random bytes, hex, kept in config.json (user profile). Never sent to the renderer. */
function hookToken(): string {
  const saved = readConfig(configFile()).token
  if (typeof saved === 'string' && /^[0-9a-f]{64}$/.test(saved)) return saved
  const token = randomBytes(32).toString('hex')
  updateConfig(configFile(), { token })
  return token
}

function startCollector(): void {
  const config = readConfig(configFile())
  collector = superviseCollector(
    COLLECTOR_ENTRY,
    {
      type: 'init',
      dbPath: join(app.getPath('userData'), 'agentdeck.db'),
      token: hookToken(),
      ports: PORTS,
      agentsDir: join(configDir(), 'agents'),
      // AGENTDECK_POLL=0: smoke tests must not list the real sessions on the machine running them.
      claude: process.env.AGENTDECK_POLL === '0' ? false : typeof config.claudePath === 'string' ? config.claudePath : undefined
    },
    onCollectorMessage,
    onCollectorDown
  )
  if (win && !win.isDestroyed()) sendWindowState(win)
}

/** D-059: until it is back, the renderer shows that it is restarting instead of an empty, "all quiet" Home. */
function onCollectorDown(): void {
  latest = null
  if (win && !win.isDestroyed()) win.webContents.send(IPC.snapshotPush, null)
  signals.update(null)
}

function onCollectorMessage(m: FromCollector): void {
  if (m.type === 'ready') {
    // The scratch-project hook config (npm run scratch:hooks) reads the port from here.
    updateConfig(configFile(), { collectorPort: m.port })
    port = m.port
    installIfConsented()
    refreshStatus()
  } else if (m.type === 'snapshot') {
    latest = m.snapshot
    if (win && !win.isDestroyed()) win.webContents.send(IPC.snapshotPush, m.snapshot)
    signals.update(m.snapshot)
  } else if (m.type === 'error') {
    console.error(`[collector] ${m.message}`)
  }
}

/** The poll slows down while nobody can see the window (D-005); "while you were away" starts on blur (D-007). */
function sendVisible(w: BrowserWindow): void {
  collector?.post({ type: 'visible', visible: w.isVisible() && !w.isMinimized() })
}
function sendFocus(focused: boolean): void {
  collector?.post({ type: 'focus', focused, at: Date.now() })
}
function sendWindowState(w: BrowserWindow): void {
  sendVisible(w)
  sendFocus(w.isFocused())
}

function watchWindow(w: BrowserWindow): void {
  const visible = (): void => sendVisible(w)
  w.on('show', visible)
  w.on('hide', visible)
  w.on('minimize', visible)
  w.on('restore', visible)
  w.on('focus', () => {
    w.flashFrame(false)
    sendFocus(true)
    // settings.json may have been edited while we were away (by hand, or by Claude Code's /hooks).
    if (!demo) refreshStatus()
  })
  w.on('blur', () => sendFocus(false))
  // Log off, restart or shutdown may end the process before will-quit (BrowserWindow § Event: 'session-end').
  w.on('session-end', removeHooksForQuit)
  sendWindowState(w)
}

function newWindow(hidden: boolean): BrowserWindow {
  const w = createMainWindow({
    hidden,
    icon: join(RESOURCES, 'icon.png'),
    title: appTitle(demo),
    onHiddenToTray: () => showTrayHintOnce(configFile())
  })
  watchWindow(w)
  w.once('ready-to-show', () => signals.render()) // the overlay badge belongs to this window's taskbar button
  return w
}

/** Shows the window, recreating it if something (a crash, a logoff race) destroyed it. */
function openWindow(): void {
  if (!app.isReady()) return
  if (!win || win.isDestroyed()) {
    win = newWindow(false)
    return // createMainWindow reveals it on ready-to-show
  }
  showWindow(win)
}

/** ADR-0011: switching modes restarts against the other source, so nothing is shared between them. */
function setDemo(on: boolean): void {
  if (on === demo) return
  demo = on
  updateConfig(configFile(), { demo: on })
  // Demo stops the collector, so our entries would point at a closed port: take them out until live is back.
  if (on) removeHooksForQuit()
  collector?.stop()
  collector = null
  latest = null
  port = null
  signals.clear()
  if (!on) startCollector()
  win?.setTitle(appTitle(on))
  tray?.setToolTip(appTitle(on))
  win?.webContents.reload()
}

function start(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  // Packaged builds drop the default menu, whose accelerators include DevTools and Reload.
  if (app.isPackaged) Menu.setApplicationMenu(null)
  serveRenderer(RENDERER_ROOT)
  demo = readConfig(configFile()).demo === true
  handle(IPC.appInfo, (): AppInfo => ({ version: app.getVersion(), demo }))
  handle(IPC.snapshot, (): Snapshot | null => (demo ? null : latest))
  handle(IPC.setDemo, (_e, on) => setDemo(z.boolean().parse(on)))
  handle(IPC.status, (): AppStatus => status ?? refreshStatus())
  handle(IPC.dismiss, (_e, id) => collector?.post({ type: 'dismiss', id: z.string().min(1).max(64).parse(id) }))
  handle(IPC.pause, (_e, choice) => setPause(z.enum(['hour', 'tomorrow']).nullable().parse(choice)))
  handle(IPC.decide, (_e, id, verdict) => onDecide(id, verdict))
  handle(IPC.previewInstall, (_e, on) => onPreviewInstall(on))
  handle(IPC.previewUninstall, () => previewUninstall(hookPaths()))
  handle(IPC.install, (_e, on) => onInstall(on))
  handle(IPC.uninstall, onUninstall)
  handle(IPC.detail, (_e, id) => detail(SessionId.parse(id)))
  handle(IPC.act, async (_e, action, id) => {
    const s = await sessionFor(SessionId.parse(id))
    return s ? act(z.enum(['attach', 'stop', 'open-folder', 'open-desktop', 'copy-resume']).parse(action), s, actionDeps) : UNKNOWN
  })
  handle(IPC.logs, async (_e, id) => {
    const s = await sessionFor(SessionId.parse(id))
    return s ? logs(s, actionDeps) : UNKNOWN
  })
  handle(IPC.openFile, (_e, path) => (demo ? DEMO_REFUSED : openFile(z.string().min(3).max(1024).parse(path))))
  handle(IPC.dispatch, (_e, req) => onDispatch(req))
  handle(IPC.chooseFolder, onChooseFolder)
  handle(IPC.runClaudeIn, (_e, cwd) => onRunClaudeIn(cwd))
  handle(IPC.listAgents, (_e, cwd) => agentsFor(Folder.nullable().parse(cwd)))
  registerAutostartOnce(configFile())

  win = newWindow(process.argv.includes('--hidden'))
  tray = createTray(join(RESOURCES, 'tray.png'), appTitle(demo), { open: openWindow, quit: () => app.quit() })
  const p = prefs()
  if (isPaused(p, Date.now())) resumeTimer = setTimeout(refreshStatus, p.pausedUntil! - Date.now())
  if (!demo) startCollector()
}

/** ADR-0012: register the login item on the first packaged run only; never the dev electron.exe. */
function registerAutostartOnce(configFile: string): void {
  if (!app.isPackaged || readConfig(configFile).autostartConfigured === true) return
  app.setLoginItemSettings({ openAtLogin: true })
  updateConfig(configFile, { autostartConfigured: true })
}

function showTrayHintOnce(configFile: string): void {
  if (!tray || readConfig(configFile).trayHintShown === true) return
  tray.displayBalloon({
    title: 'AgentDeck is still running',
    content: 'It keeps watching your agents from the tray. Quit from the tray menu.'
  })
  updateConfig(configFile, { trayHintShown: true })
}
