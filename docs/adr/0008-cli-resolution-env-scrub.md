# ADR-0008: Resolving the Claude Code CLI and scrubbing the spawn environment

- Status: Accepted, 2026-11-05

## Context
- Found on this machine (F1, S8):
  - The native CLI is at `%USERPROFILE%\.local\bin\claude.exe` (2.1.318).
  - Claude Desktop's Electron binary is **also named `claude.exe`** (`C:\Program Files\WindowsApps\Claude_*\app\claude.exe`).
  - Desktop runs its own bundled CLI at `%LOCALAPPDATA%\Claude-Data\claude_*\claude-code\<ver>\claude.exe` (2.1.317).
- Subprocesses of Claude Code inherit `CLAUDECODE=1`, `CLAUDE_CODE_CHILD_SESSION=1`, `CLAUDE_CODE_SESSION_ID` and more. The env-vars docs say a nested session started that way is excluded from the `claude agents` list. A dev build launched from a Claude terminal would therefore dispatch invisible sessions.

## Decision
- **Resolution order** (D-024), re-run on Settings change and on "Repair":
  1. The Settings override path.
  2. `%USERPROFILE%\.local\bin\claude.exe`.
  3. `where.exe claude` results, excluding paths under `WindowsApps\Claude_` and `Claude-Data`.
  4. npm global `claude.cmd`.
- A candidate is accepted only if `"<path>" --version` prints `^\d+\.\d+\.\d+ \(Claude Code\)` within 5 s.
- The result and its version are shown in Diagnostics. If no candidate passes, Diagnostics shows "Claude Code not found" with a Browse… override.
- **Every spawn:**
  - uses `cross-spawn` with an argument array, never a shell string;
  - sets `windowsHide: true`, except for Attach;
  - has a timeout (poll 10 s, logs 10 s, stop 15 s, dispatch 30 s);
  - gets an env with **every `CLAUDE*` variable removed** (D-025);
  - leaves `PATH` and `USERPROFILE` intact.
- **Attach:** `wt.exe -d <cwd> <claude> attach <id>` when `wt.exe` resolves. Otherwise spawn `<claude> attach <id>` with `detached:true, stdio:'ignore', cwd` so Windows gives it its own console (F13: Windows Terminal is not installed here). PowerShell is not needed.
- `code -g <file>` goes through cross-spawn, which handles `code.cmd` without a shell string.

## Consequences
- AgentDeck never runs the Desktop app by accident, and its sessions always show up in `claude agents`.
- Users with a non-standard install set the override once.
