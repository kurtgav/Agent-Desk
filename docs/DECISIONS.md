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
| D-033 | Controls whose backing arrives later keep their look but are `aria-disabled`, carry `data-pending="M3…M5"` (M2 ones moved, D-055), show "Arrives with … (Mx)" on hover, and do nothing. The M5 gate asserts no `[data-pending]` remains | "no dead controls" without hiding the layout the reference defines |
| D-034 | Composer effort chip defaults to **High** and cycles low → medium → high → xhigh → max (`--effort`) | the CLI's documented values (F11); High is a sane default for dispatched work |
| D-035 | Demo answers (Approve / Reject / Dismiss) remove the item locally and announce "… in demo: nothing was sent." Approving an item with risk flags opens a confirm dialog showing the full command | lets the M1 flow be tried honestly; the confirm step is the M4 behaviour |
| D-036 | TypeScript pinned to **6.0.3** | typescript-eslint 8.72 supports `<6.1.0` |
| D-037 | Needs-you rows for requests AgentDeck is not holding say where to answer: "Answer in terminal" (popover with the cwd) for CLI / VS Code, "Open in Desktop" and "Attach" for Desktop and background (M4) | AgentDeck never fakes an answer it can't deliver |
| D-038 | The composer's text box and its project, agent and effort pickers work in M1 (they only hold choices on screen); **Dispatch** is the pending control (M4). Nothing is sent or spawned | a form can be filled before its submit exists; the one action that would leave the window is the one held back |
| D-039 | Needs-you approval titles wrap instead of truncating, so the end of a long command is always visible before Approve | a hidden tail can hide the risky part |
| D-040 | **UI transport: collector → main → renderer.** The collector posts the Home snapshot over `parentPort` (≤ every 100 ms after a change, 30 s heartbeat); main caches it and pushes `snapshot:push`; preload offers `getSnapshot` / `onSnapshot`. No REST or SSE from the renderer (ADR-0002 M2 amendment) | a fetch from `app://` sends an `Origin` and a CORS preflight, which ADR-0010 rejects; keeps port and token out of the renderer |
| D-041 | Collector HTTP server is `node:http`, not Fastify | three routes and four checks; one dependency fewer |
| D-042 | Storage is `node:sqlite` (`DatabaseSync`), not better-sqlite3 | built into Electron 45's Node 24: no native rebuild (R15 closed) |
| D-043 | **Live mode is the default.** "Demo data" in the switcher menu is a checkbox; main persists it, stops/starts the collector, sets title and tray tooltip, and reloads the window | M2 has real data; demo stays one click away for screenshots (ADR-0011 M2 note) |
| D-044 | Event dedupe key = SHA-256 of the raw hook body (applied within 2 s only, D-056) | EVENT_SCHEMA's field-based key collides: TaskCreated and SubagentStart in S1 share `prompt_id` and session. A redelivered body is byte-identical |
| D-045 | Surface comes from the pid's exe path, read with one `powershell.exe -NoProfile -NonInteractive -Command Get-Process -Id …` call per batch of **new** pids (integers only, nothing else interpolated), cached per pid | Node has no API for another process's image path; `wmic` is deprecated; PowerShell is in-box |
| D-046 | Snapshot holds sessions that are live or active this week (newest 50) and the latest change per file this week (newest 200) | Home shows at most 6 tiles and 4 rows; the M4 list pages will query the store |
| D-047 | Env scrub (D-025) **keeps `CLAUDE_CONFIG_DIR`** | `claude agents` must read the same config dir the user chose |
| D-048 | `AGENTDECK_POLL=0` turns the poller off; smoke tests also point `CLAUDE_CONFIG_DIR` at their temp folder | tests must not list, show or count the real sessions and agents of the machine running them |
| D-049 | Hook token (32 random bytes, hex) and the bound `collectorPort` live in `config.json`; the token is created on the first live start, the port rewritten on every collector start | the M3 installer and `npm run scratch:hooks` read both from one place |
| D-050 | Until the attention engine (M3), the reducer's `waitingOn` (the agent whose PermissionRequest put the session in needs_you) stands in for the P1 item: that agent's next non-notification event means it was answered | S4: no event reports the answer itself; after allow the tool's PostToolUse follows, after deny the Stop |
| D-051 | Activity text without a tool: "Thinking" after a prompt, "Working" when only the poll says busy, "Finished" after Stop, "Idle" on an idle poll, "Waiting for your OK" / "Waiting for your answer" from the poll's `waitingFor` | real words for real states; nothing invented |
| D-052 | Subagent types in the sidebar come from `SubagentStart` events only | main-thread events also carry `agent_type` under `--agent` (COMPATIBILITY § Hooks) |
| D-053 | 413 replies carry `Connection: close` and the socket is closed after the reply is flushed | destroying at once reset the client before it read the 413 |
| D-054 | Needs_you sessions with no attention item count as P1 in "Waiting for you", the summary line and the Approvals badge, and the Needs-you card names them ("Waiting in its own window: …") | before M3 there are no items, and no number may say nothing waits while a session does |
| D-055 | The list pages and filters (Sessions, Files, Activity, project and agent nav, All agents, Search, "View all" / "See all", the top-bar avatar stack) move from M2 to **M4**, labelled "Arrives with lists and actions (M4)". `Milestone` no longer has `'M2'`, so no control can still promise it | the brief's M2 is live Home data ("Running now, agents, files and KPIs all live"); the lists are where M4's actions (attach, stop, open file) live |
| D-056 | Dedupe (D-044) applies **within 2 s** only, in memory; `events.dedupe_key` is written NULL | M2 code review: PermissionRequest has no per-request field, so a second ask for the same command is byte-identical and a permanent `UNIQUE` key dropped it, so the session never showed needs_you |
| D-057 | On restart, `working` sessions close their stretch at their last event and show `idle`; the Poller is seeded with the stored live sessions, so its first poll ends the ones it doesn't list. `session.gone` leaves `lastEventAt` alone | M2 code review: sessions that ended while AgentDeck was closed stayed `working` for up to 30 days and counted the downtime as agent time. Undercounting what nobody saw is honest; overcounting is not |
| D-058 | A poll row held back by the 5 s hook window is stored on the session and applied once the window passes (the Poller reports after every successful poll, changed rows or not) | M2 code review: the Poller only emits changes, so an Esc seen inside the window was never applied and the session showed `working` indefinitely |
| D-059 | When the collector exits unasked, main pushes `null` and Home shows "The collector stopped. AgentDeck is restarting it." (and "Starting the collector…" before the first snapshot) instead of the cards | M2 code review: an empty snapshot read as "All quiet" and "No agent is running" while nothing was being watched |
| D-060 | "While you were away" counts `[awaySince, awayUntil]`: from losing focus to getting it back (`awayUntil` is new in the snapshot, null while still away) | M2 code review: without the end, turns that finished after you came back were also counted as "while you were away" |
| D-061 | Redaction: drop bodies → mask → cap; each string scanned up to 16 KB, objects up to 32 deep; keys with any prefix (`NPM_TOKEN`), quoted and escaped JSON, `--password x`, secret-named object keys, more vendor prefixes; poll rows reduced to their documented fields | M2 security review HIGH-1/2, MEDIUM-3/4, LOW-5 (EVENT_SCHEMA § Redaction) |
| D-062 | `where.exe` and `powershell.exe` run by absolute `%SystemRoot%\System32` path; `run()` settles on timeout instead of waiting for `close` | M2 reviews: Windows looks in the cwd before PATH; a killed `.cmd` shim's child can hold the pipe open, which stalled the Poller |
| D-063 | Zero cost, open source: MIT licence (copyright Kurt Gavin), public repo `kurtgav/Agent-Desk`, CI on GitHub Actions (free for public repos), no paid service, account or cloud dependency, no code-signing certificate (ADR-0012) | User, 2026-11-05: "zero cost … use this locally and will opensource this to other developer". MIT is the most permissive common licence and needs no contributor agreement; `"private": true` stays so it is never published to npm by accident |
