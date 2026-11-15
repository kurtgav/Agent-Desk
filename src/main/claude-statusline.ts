// ADR-0009 amendment (status line): the `statusLine` entry that runs AgentDeck's script, the script itself, and how to tell
// the entry is ours. Pure text, no imports from the settings writer, so hooks-install.ts can use it for its validation.
import { posix, win32 } from 'node:path'

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Files in `<userData>/statusline`. */
export const LIMITS_FILE = 'rate-limits.json'
export const PREVIOUS_FILE = 'previous.json'
/** The user's own command, as files both shells can run: bash takes no BOM, Windows PowerShell 5.1 needs one for non-ASCII. */
export const PREVIOUS_SH = 'previous-command.sh'
export const PREVIOUS_PS1 = 'previous-command.ps1'
/** Claude Code also runs the status line when a window resets; this keeps the figures fresh while a session sits idle. */
export const REFRESH_SEC = 60

const OUR_SCRIPT = /agentdeck-statusline\.(?:ps1|sh)\b/

export const scriptName = (platform: NodeJS.Platform): string => (platform === 'win32' ? 'agentdeck-statusline.ps1' : 'agentdeck-statusline.sh')
export const scriptPath = (dir: string, platform: NodeJS.Platform): string => (platform === 'win32' ? win32 : posix).join(dir, scriptName(platform))

/** Ours = a command status line that runs a script named agentdeck-statusline.ps1 or .sh, from any folder. */
export const isOurStatusLine = (v: unknown): boolean => isObj(v) && v.type === 'command' && typeof v.command === 'string' && OUR_SCRIPT.test(v.command)

/** A PowerShell single-quoted literal: only quotes are special, and PowerShell counts the curly ones as quotes too. */
const psQuote = (s: string): string => `'${s.replace(/['\u2018\u2019\u201A\u201B]/g, '$&$&')}'`
/** A POSIX sh single-quoted literal. */
export const shQuote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`

/**
 * One quoting both Git Bash and PowerShell read the same way (Claude Code runs the command through either): double quotes,
 * unless the path holds `$` or a backtick (special inside them in both), then single quotes. A path with both kinds can't be.
 */
function quoteBoth(p: string): string {
  if (!/[$`"]/.test(p)) return `"${p}"`
  if (!/['\u2018\u2019\u201A\u201B]/.test(p)) return `'${p}'`
  throw new Error(`AgentDeck's data folder (${p}) has characters a status line command cannot quote, so AgentDeck left settings.json alone.`)
}

/** The `statusLine.command` AgentDeck writes. Forward slashes on Windows, as Claude Code's docs ask. */
export function statusLineCommand(dir: string, platform: NodeJS.Platform): string {
  const script = scriptPath(dir, platform)
  return platform === 'win32' ? `powershell -NoProfile -ExecutionPolicy Bypass -File ${quoteBoth(script.replaceAll('\\', '/'))}` : `sh ${shQuote(script)}`
}

/** Our entry: the user's own keys (padding, hideVimModeIndicator) stay; a refresh interval shorter than ours stays too. */
export function ourStatusLine(current: unknown, command: string): Json {
  const own = isObj(current) ? current : {}
  const theirs = own.refreshInterval
  const refreshInterval = typeof theirs === 'number' && Number.isFinite(theirs) && theirs >= 1 && theirs < REFRESH_SEC ? theirs : REFRESH_SEC
  return { ...own, type: 'command', command, refreshInterval }
}

/** The user's own command to run after ours, or null when their status line had none. */
export const previousCommand = (previous: unknown): string | null =>
  isObj(previous) && previous.type === 'command' && typeof previous.command === 'string' && previous.command.trim() ? previous.command : null

/**
 * Windows. Reads Claude Code's status line input, saves only `rate_limits` (atomically: a temp file, then a replace), then runs
 * the user's previous command with the same input the way Claude Code would (Git Bash when it finds one, else PowerShell) and
 * prints what it prints. Every error is swallowed and it always exits 0: a failure here must never blank the status line.
 * Written with a BOM, so Windows PowerShell 5.1 reads a non-ASCII folder name right.
 */
export function powershellScript(dir: string): string {
  return `\uFEFF# AgentDeck's status line (ADR-0009). Saves only the plan limits Claude Code passes in (rate_limits) for AgentDeck to
# show, then runs your own status line, if you had one, and prints what it prints. Written by AgentDeck: turning off
# "Show my plan's session and weekly limits" in AgentDeck's Settings puts your own status line back.
$ErrorActionPreference = 'SilentlyContinue'
$dir = ${psQuote(dir)}
$utf8 = New-Object System.Text.UTF8Encoding $false
try { [Console]::InputEncoding = $utf8 } catch {}
try { [Console]::OutputEncoding = $utf8 } catch {}
$OutputEncoding = $utf8
$in = [Console]::In.ReadToEnd()
try {
  $limits = ($in | ConvertFrom-Json).rate_limits
  if ($null -ne $limits) {
    $file = Join-Path $dir '${LIMITS_FILE}'
    $tmp = Join-Path $dir ('rate-limits.' + $PID + '.tmp')
    [System.IO.File]::WriteAllText($tmp, ($limits | ConvertTo-Json -Compress -Depth 5), $utf8)
    try { [System.IO.File]::Replace($tmp, $file, $null) } catch { Move-Item -LiteralPath $tmp -Destination $file -Force }
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
  }
} catch {}
try {
  $sh = Join-Path $dir '${PREVIOUS_SH}'
  if (Test-Path -LiteralPath $sh) {
    $bash = $env:CLAUDE_CODE_GIT_BASH_PATH
    if (-not ($bash -and (Test-Path -LiteralPath $bash))) {
      # Git for Windows: git.exe sits in cmd\\, bin\\ or mingw64\\bin\\; bash.exe in bin\\ of the same install.
      $bash = $null
      $git = (Get-Command git.exe -CommandType Application | Select-Object -First 1).Source
      if ($git) { $d = Split-Path $git; foreach ($i in 1..3) { $d = Split-Path $d; if ($d -and (Test-Path -LiteralPath (Join-Path $d 'bin\\bash.exe'))) { $bash = Join-Path $d 'bin\\bash.exe'; break } } }
    }
    if ($bash -and (Test-Path -LiteralPath $bash)) { $out = $in | & $bash ($sh -replace '\\\\', '/') }
    else { $out = $in | & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir '${PREVIOUS_PS1}') }
    if ($null -ne $out) { [Console]::Out.Write((@($out) -join "\`n")) }
  }
} catch {}
exit 0
`
}

/**
 * macOS and Linux. No jq to count on, so it saves the whole input (only when it holds rate_limits) and the reader takes
 * rate_limits alone; then it runs the user's previous command with the same input. Always exits 0.
 */
export function shScript(dir: string): string {
  return `#!/bin/sh
# AgentDeck's status line (ADR-0009). Saves Claude Code's status line input for AgentDeck, which reads only the plan
# limits (rate_limits) from it, then runs your own status line, if you had one, and prints what it prints. Written by
# AgentDeck: turning off "Show my plan's session and weekly limits" in AgentDeck's Settings puts your own status line back.
dir=${shQuote(dir)}
input=$(cat)
case $input in
  *'"rate_limits"'*)
    tmp="$dir/rate-limits.$$.tmp"
    if printf '%s' "$input" > "$tmp" 2>/dev/null; then mv -f "$tmp" "$dir/${LIMITS_FILE}" 2>/dev/null || rm -f "$tmp" 2>/dev/null; fi
    ;;
esac
if [ -f "$dir/${PREVIOUS_SH}" ]; then printf '%s' "$input" | sh "$dir/${PREVIOUS_SH}"; fi
exit 0
`
}

export const statusLineScript = (dir: string, platform: NodeJS.Platform): string => (platform === 'win32' ? powershellScript(dir) : shScript(dir))
