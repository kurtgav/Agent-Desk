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
| D-031 | **M1 demo data lives in the renderer** (`src/renderer/src/demo/snapshot.ts`), typed by the same zod `Snapshot` contract the collector will serve from M2. ADR-0011's `demo.db` replay lands with the collector in M2 | there is no collector or reducer in M1 to replay through; one contract keeps the swap mechanical |
| D-032 | Tuned M1 tokens (UI_MAP § Layout tokens): filled buttons `#0071E3`, muted `#6B6B72`, status label inks. The main area is a **flush sheet** (border-left + white top bar) instead of the reference's inset rounded sheet | AA contrast; Windows caption buttons from `titleBarOverlay` need a solid strip across the top |
| D-033 | Controls whose backing arrives later keep their look but are `aria-disabled`, carry `data-pending="M2…M5"`, show "Arrives with … (Mx)" on hover, and do nothing. The M5 gate asserts no `[data-pending]` remains | "no dead controls" without hiding the layout the reference defines |
| D-034 | Composer effort chip defaults to **High** and cycles low → medium → high → xhigh → max (`--effort`) | the CLI's documented values (F11); High is a sane default for dispatched work |
| D-035 | Demo answers (Approve / Reject / Dismiss) remove the item locally and announce "… in demo: nothing was sent." Approving an item with risk flags opens a confirm dialog showing the full command | lets the M1 flow be tried honestly; the confirm step is the M4 behaviour |
| D-036 | TypeScript pinned to **6.0.3** | typescript-eslint 8.72 supports `<6.1.0` |
| D-037 | Needs-you rows for requests AgentDeck is not holding say where to answer: "Answer in terminal" (popover with the cwd) for CLI / VS Code, "Open in Desktop" and "Attach" for Desktop and background (M4) | AgentDeck never fakes an answer it can't deliver |
| D-038 | The composer's text box and its project, agent and effort pickers work in M1 (they only hold choices on screen); **Dispatch** is the pending control (M4). Nothing is sent or spawned | a form can be filled before its submit exists; the one action that would leave the window is the one held back |
| D-039 | Needs-you approval titles wrap instead of truncating, so the end of a long command is always visible before Approve | a hidden tail can hide the risky part |
