import { basename } from 'node:path'
import { run, system32 } from '../collector/cli'

/**
 * Brings the window that hosts a session to the front: "Answer in terminal" takes you there. It starts at the session's own
 * process and walks up its parents (shell, terminal host) to the first one that owns a visible window, the way you would
 * look for the tab by hand. The pid reaches the script as an integer in the environment, so nothing is interpolated into it
 * (ADR-0008). Windows only lets the foreground thread hand focus on, so the script borrows its input queue for a moment.
 *
 * shortcut: one window per terminal app. Warp and Windows Terminal keep every tab in one window and have no interface to pick
 * a tab, so the user still picks the tab; the toast names the project folder to look for.
 */
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AgentDeckWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
'@
$start = [int]$env:AGENTDECK_PID
$parents = @{}
Get-CimInstance Win32_Process | ForEach-Object { $parents[[int]$_.ProcessId] = [int]$_.ParentProcessId }
$h = [IntPtr]::Zero
$app = ''
$cur = $start
$hops = 0
while ($cur -gt 0 -and $hops -lt 12) {
  $p = Get-Process -Id $cur -ErrorAction SilentlyContinue
  if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero -and [AgentDeckWin]::IsWindowVisible($p.MainWindowHandle)) { $h = $p.MainWindowHandle; $app = $p.ProcessName; break }
  if (-not $parents.ContainsKey($cur)) { break }
  $cur = $parents[$cur]
  $hops++
}
if ($h -eq [IntPtr]::Zero) { Write-Output 'NOWINDOW'; exit 3 }
if ($env:AGENTDECK_FOCUS_DRY -eq '1') { Write-Output ('FOUND ' + $app); exit 0 }
if ([AgentDeckWin]::IsIconic($h)) { [void][AgentDeckWin]::ShowWindowAsync($h, 9) }
$fg = [AgentDeckWin]::GetForegroundWindow()
$fgPid = [uint32]0
$fgThread = [AgentDeckWin]::GetWindowThreadProcessId($fg, [ref]$fgPid)
$me = [AgentDeckWin]::GetCurrentThreadId()
[void][AgentDeckWin]::AttachThreadInput($me, $fgThread, $true)
[void][AgentDeckWin]::BringWindowToTop($h)
[void][AgentDeckWin]::SetForegroundWindow($h)
[void][AgentDeckWin]::AttachThreadInput($me, $fgThread, $false)
Write-Output ('OK ' + $app)
`

const TIMEOUT_MS = 15_000

export type FocusResult = { ok: true; app: string } | { ok: false; reason: 'no-window' | 'failed' }

/** What the script printed. Anything it did not say is a failure, never a guess. */
export function parseFocus(stdout: string): FocusResult {
  const found = /^(?:OK|FOUND) (.+)$/m.exec(stdout)
  if (found) return { ok: true, app: found[1]!.trim() }
  return { ok: false, reason: /^NOWINDOW$/m.test(stdout) ? 'no-window' : 'failed' }
}

const MAX_HOPS = 12

/**
 * macOS: the app bundle the session runs under, from `ps -axo pid=,ppid=,comm=`: walk up from `pid` to the first process
 * started from inside an `.app`, and take the outermost bundle (VS Code's terminal runs under `Code Helper.app` inside
 * `Visual Studio Code.app`). Null when no ancestor is an app (tmux, ssh, a launchd job).
 */
export function macAppOf(ps: string, pid: number): string | null {
  const procs = new Map<number, { ppid: number; comm: string }>()
  for (const m of ps.matchAll(/^\s*(\d+)\s+(\d+)\s+(.+)$/gm)) procs.set(Number(m[1]), { ppid: Number(m[2]), comm: m[3]!.trim() })
  let cur = pid
  for (let hops = 0; cur > 1 && hops < MAX_HOPS; hops++) {
    const p = procs.get(cur)
    if (!p) return null
    const app = /^(\/.*?\.app)\//.exec(p.comm)?.[1]
    if (app) return app
    cur = p.ppid
  }
  return null
}

/**
 * macOS, best effort: activates the terminal app the session runs in with `open -a <bundle>` (Launch Services, so no
 * Automation or Accessibility prompt). Like Windows, it brings the app forward, not the one tab: the user picks the tab.
 */
async function focusMac(pid: number, exec: typeof run, dry: boolean): Promise<FocusResult> {
  const ps = await exec('/bin/ps', ['-axo', 'pid=,ppid=,comm='], TIMEOUT_MS)
  if (ps.code !== 0) return { ok: false, reason: 'failed' }
  const app = macAppOf(ps.stdout, pid)
  if (!app) return { ok: false, reason: 'no-window' }
  const name = basename(app, '.app')
  if (dry) return { ok: true, app: name }
  return (await exec('/usr/bin/open', ['-a', app], TIMEOUT_MS)).code === 0 ? { ok: true, app: name } : { ok: false, reason: 'failed' }
}

/** `dry` only finds the window and reports it; it never changes focus (for tests and checks). */
export async function focusWindowOf(pid: number, exec: typeof run = run, dry = false, platform: NodeJS.Platform = process.platform): Promise<FocusResult> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return { ok: false, reason: 'failed' }
  if (platform === 'darwin') return focusMac(pid, exec, dry)
  const env = { ...process.env, AGENTDECK_PID: String(pid), ...(dry ? { AGENTDECK_FOCUS_DRY: '1' } : {}) }
  const r = await exec(system32('WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT], TIMEOUT_MS, env)
  return parseFocus(r.stdout)
}
