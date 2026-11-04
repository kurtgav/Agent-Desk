# Risk register

L = likelihood and I = impact, each H/M/L. "When" is the milestone where a risk is closed or re-checked.

| ID | Risk | L | I | Mitigation | When | Status |
|---|---|---|---|---|---|---|
| R1 | Claude Code changes a hook or CLI contract (it ships often; 2.1.317 and 2.1.318 already coexist here) | H | H | COMPATIBILITY.md per version; zod parsing that tolerates unknown fields (`kind:"unknown"`, not reject); fixture tests per CLI version; Diagnostics shows parse misses per event | every milestone | open |
| R2 | AgentDeck crashes and leaves hook entries in settings.json | M | M | Collector crash → main restarts it, so the port stays served. Main crash → entries remain until the next launch (autostart reconciles). Measured cost while orphaned: 4–57 ms per hook and 1 stderr line per `-p` run (S2), with no model impact | M3 | mitigated |
| R3 | Concurrent writers to settings.json (Claude `/config`, other tools, the user) | M | H | Read, then parse, merge only our entries, write to temp, re-read the original and compare its hash (retry ≤ 3), atomic rename, validate by re-parsing. Backup before every write (last 20 in `%APPDATA%\AgentDeck\backups`). Never reorder or reformat foreign keys beyond JSON re-serialization (shown in the diff) | M3 | open |
| R4 | Untrusted folders send no hook events in interactive sessions (docs) | M | M | Poll-only fallback with a "Hooks blocked: folder not trusted" label. Never write trust ourselves | M2 | open |
| R5 | **Auto-resolve within 2 s after answering in the terminal is unmeasured.** A long-running approved tool sends its Post event only when it finishes | M | M | 1 s poll while a P1 is open (≈ 2.6 % CPU for up to 2 min); any later event resolves the item; OTel `tool_decision` when enabled. Measure with S7b in M3 | M3 | open |
| R6 | Poll CPU: 312 ms of CPU per `claude agents --json` call (S5) | H | M | Cadence: 3 s visible / 15 s hidden / 1 s for P1 only; one poll at a time; idle budget checked with the hidden window in M5 (expected ≈ 0.2 %) | M5 | open |
| R7 | The first HTTP hook of a session takes 148–530 ms with the collector up (S2, client warm-up inside Claude Code) | M | L | Outside our ingest budget, which is measured on the collector side; documented. Re-measure against Fastify in M2 | M2 | open |
| R8 | Desktop runs its own bundled CLI (2.1.317): user hooks may load differently, versions lag | M | M | Desktop sessions verified in the poll only. Verify hooks from Desktop sessions in M2; matrix column per version | M2 | open |
| R9 | VS Code surface not verified | M | L | Exe-path surface detection; verify with a VS Code session in M2 | M2 | open |
| R10 | Remote approvals defer the terminal prompt for up to `approvalWaitSec` | H | M | Off by default; Settings explains the deferral; wait 60 s, then an empty reply and the normal prompt; quit answers every held request first | M4 | open |
| R11 | A local process reads the token from settings.json | L | M | Loopback + Host check + no-Origin rule; approve requires a click in the UI (no API approve); accepted local threat model | M2 | accepted |
| R12 | PII in OTel (email, account and org ids on every signal) | H | M | Dropped at ingest; fixtures redacted (`redact-fixtures.mjs` fails on email-like strings) | M5 | mitigated |
| R13 | Windows path case drift (`D:\PERSONAL` vs `D:\personal`; `~/.claude.json` already has duplicate-case project keys) | H | L | Normalize cwd keys to lower case + `path.resolve` for grouping and comparison; display the original | M2 | open |
| R14 | Large agent catalog (346) slows the Agents page and the subagent picker | M | L | Lazy parse of frontmatter only; virtualized list; picker search | M4 | open |
| R15 | better-sqlite3 native ABI vs Electron in a utilityProcess | M | M | `@electron/rebuild` in postinstall; CI on windows-latest runs the packaged smoke test | M2 | open |
| R16 | Port 47821 already taken | L | M | `/health` probe with our token; not ours → next free port in 47822–47831, hook URLs rewritten; Diagnostics shows it | M2 | open |
| R17 | Agent view disabled (`disableAgentView`, `CLAUDE_CODE_DISABLE_AGENT_VIEW`), or `--json` output changes | L | M | Hooks-only degraded mode; the registry banner in Diagnostics | M2 | open |
| R18 | `claude --bg` refuses folders with project hooks (`Workspace not trusted`, S6) | M | L | Match the message, show the fix + an "Open terminal here" button; never edit trust | M4 | open |
| R19 | Toasts need an AppUserModelID and a Start-menu shortcut; dev builds may not show them | M | L | Set AUMID; the NSIS installer creates the shortcut; test the packaged build | M3 | open |
| R20 | Sleep/resume leaves stale states or a dead poller | M | M | `powerMonitor` resume → force poll, mark stale, re-check the port | M5 | open |
| R21 | User already exports OTel elsewhere (a company collector) | L | M | Detect existing `OTEL_*` / `CLAUDE_CODE_ENABLE_TELEMETRY` in the env block or managed settings → never override; Usage card says "telemetry configured elsewhere" | M5 | open |
| R22 | OTel changes apply only to new sessions (read at startup) | H | L | Consent dialog states it; the Usage card shows "since <time>" | M5 | accepted |
| R23 | Attach on a machine without Windows Terminal (this one) | H | L | `detached:true` spawn gives the child its own console window; `wt` is used when present | M4 | open |
| R24 | Nested dev runs: AgentDeck started from a Claude terminal inherits `CLAUDECODE` / `CLAUDE_CODE_CHILD_SESSION`, and dispatched sessions then vanish from `claude agents` | M | M | Scrub every `CLAUDE*` var before any `claude` spawn (ADR-0008) | M4 | mitigated |
| R25 | Interactive TUI hook-error notice when the endpoint is down is unverified (S7b) | M | L | Lifecycle already assumes visibility (ADR-0005), so the outcome does not change the design | M3 | accepted |
| R26 | The user's main sessions run `--dangerously-skip-permissions`, so few approval prompts reach AgentDeck | H | L | Expected: P1 approvals come mostly from Desktop/bg; P3/P4 remain valuable | — | accepted |
