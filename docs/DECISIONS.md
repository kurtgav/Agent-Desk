# Decisions log (defaults picked without asking)

These are small calls made to keep moving, as the brief asks: pick sensible defaults and log them. Larger choices are ADRs. Change any of these by editing here and noting the new value plus the date.

| ID | Decision | Why |
|---|---|---|
| D-001 | Collector port **47821**, fallback range 47822–47831 | from the brief; the fallback covers R16 |
| D-002 | Observation hook `timeout: 2`. PermissionRequest uses `approvalWaitSec + 10` only while remote approvals are on | brief; S3 shows timeout caps our worst case |
| D-003 | Hook entries exist only while AgentDeck runs (ADR-0005) | S2: a failure line reaches the user in `-p` |
| D-004 | **No SessionStart hook in v1.** Sessions are discovered by the poll and by their first hook event; `model` comes from OTel | F3: HTTP hooks are unsupported on SessionStart; a command hook would cost a process spawn per session |
| D-005 | Poll cadence: 3 s visible / 15 s hidden / 1 s while a P1 is open (≤ 2 min per item); 300 ms debounce after hook events; one poll at a time | S5 cost numbers |
| D-006 | Stall thresholds: N = 5 min without events, M = 10 min for one tool | brief asks for configurable values; these are the starting defaults |
| D-007 | "While you were away" = since the AgentDeck window last had focus | honest, needs no idle tracking |
| D-008 | A week starts Monday 00:00 local time | ISO week |
| D-009 | "Waiting for you" = open P1 + P2 items | matches the "needs your OK" sentence; P3/P4 aren't asks |
| D-010 | "Tasks finished" = main-thread `Stop` with `stop_hook_active=false`, plus bg `state→done`; synthetic `<task-notification>` prompts excluded | S1 |
| D-011 | "Files changed" = distinct `file_path` / `notebook_path` from PostToolUse of Edit, Write, NotebookEdit, MultiEdit; Bash-made changes are not counted (a tooltip says so) | only edit tools give exact paths |
| D-012 | "Agent time" = per-session sum of intervals from `session.prompt` to `turn.stopped` / `turn.failed`, minus time with an open P1, plus bg `state=working` time from the poll; subagents are not double-counted | measured working time; never "time saved" |
| D-013 | Paths are compared case-insensitively after `path.resolve` (Windows); the original is displayed | S6, R13 |
| D-014 | Display name comes from Settings, default **"Kurt"**; no account data is read | brief; the credential rule |
| D-015 | Avatars: FNV-1a hash of `agentType` (subagents) or session name → one of 6 shapes × 12 hues (AA-checked) | deterministic, original art |
| D-016 | No default budget; the Usage card asks you to set one | no guessing about spend |
| D-017 | Remote approvals off by default; `approvalWaitSec` = 60 | brief |
| D-018 | Toasts on for P1, P2 and completions; quiet hours off (preset 22:00–08:00 when enabled) | brief |
| D-019 | Data dir `%APPDATA%\AgentDeck` (db, config, logs, backups) | Windows convention; keeps writes out of `~/.claude` |
| D-020 | `AgentEvent` gains a `toolUseId` column (the brief's field list had none) | needed to index correlation (S4) |
| D-021 | Surface = exe path of the session `pid`: `\Claude-Data\` or `WindowsApps\Claude_` → Desktop; `\.vscode\extensions\` or `\.cursor\` → IDE; else CLI; `kind=background` → Background | S8 |
| D-022 | "Our" hook entry = `type:"http"` ∧ url `^http://127\.0\.0\.1:\d+/hooks$` ∧ header `X-AgentDeck-Token` | survives port changes; never matches user entries |
| D-023 | Settings backups go to `%APPDATA%\AgentDeck\backups\settings.<ts>.json` (keep 20), not under `~/.claude` | fewer writes in `~/.claude` |
| D-024 | CLI resolution order: Settings override → `%USERPROFILE%\.local\bin\claude.exe` → `where claude` hits, skipping `WindowsApps\Claude_*` and `Claude-Data` paths; each candidate must print `^\d+\.\d+\.\d+ \(Claude Code\)` | F1 |
| D-025 | Spawned `claude` processes get a clean env: every `CLAUDE*` variable removed | F8, R24 |
| D-026 | Fixtures are committed only after `redact-fixtures.mjs`; `spikes/out/` is git-ignored | OTel PII, debug logs |
| D-027 | Desktop-surface sessions get "Open in Claude Desktop" (`claude --desktop --resume <sessionId>`) instead of Attach (verify in M4) | Desktop sessions have no terminal |
| D-028 | `claude logs` output: ANSI SGR converted to styled spans, cursor codes stripped, capped at 200 lines | S7 output is a screen dump |
| D-029 | Hook endpoint replies 200 with an **empty** body, except held PermissionRequest decisions | S2: empty 2xx = success, no parsing on their side |
| D-030 | Spike runs use `--model haiku`, and `-p` runs use `--no-session-persistence` | cost and no transcript writes |
