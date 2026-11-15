# Compatibility matrix

Each interface AgentDeck relies on, the source behind it, and how it was verified.
- **spike Sx**: observed on this machine (docs/SPIKES.md).
- **live**: observed against the user's running sessions.
- **docs**: stated in the docs only.
- **unverified**: needed but not yet observed.

Docs read on 2026-11-05 from `https://code.claude.com/docs/en/<page>` (§ = section heading). Versions: CLI **2.1.318**, Desktop-bundled CLI **2.1.317**. Re-check this file on every Claude Code minor bump; Diagnostics shows the running versions.

## Hooks
| Interface | What AgentDeck relies on | Source | 2.1.318 | 2.1.317 (Desktop) |
|---|---|---|---|---|
| `type:"http"` handler | `url`, `headers`, `timeout`; JSON POST body | hooks § HTTP hook fields | spike S1; live M2 (collector, real `-p` run) | unverified |
| Not on SessionStart / Setup | "They don't support `http`…" | hooks § Prompt-based hooks | docs | docs |
| Failure is non-blocking | refused / non-2xx / timeout → action continues | hooks § HTTP response handling | spike S2 | unverified |
| Timeout cancels the hook | cancelled at `timeout`; default 600 s otherwise | hooks § Common fields, § Timeouts | spike S3 | — |
| `SessionEnd` budget | 1.5 s, raised to match a longer per-hook `timeout` (max 60 s) | hooks § Common fields | docs | docs |
| PermissionRequest decision | `hookSpecificOutput.decision.behavior` allow/deny + `message` | hooks § PermissionRequest decision control | spike S4 | unverified |
| PermissionRequest input | `tool_name`, `tool_input`, `permission_suggestions`; **no `tool_use_id`** | hooks § PermissionRequest input | spike S4 | — |
| No decision in a no-prompt session | tool denied | hooks § PermissionRequest | spike S4 | — |
| Empty reply in an interactive session | normal dialog shows | hooks (implied, not stated) | **unverified (S7b)** | unverified |
| Held PermissionRequest (remote approvals) | the session waits for our reply up to the entry's `timeout` (wait + 10 s), and its own prompt is deferred meanwhile | hooks § Common fields (`timeout`), § PermissionRequest decision control | collector side: `app.test.ts` over HTTP; terminal side **unverified (S7b, R34)** | unverified |
| Subagent attribution | `agent_id` only inside subagents; `agent_type` also on the main thread under `--agent` (S1's main thread carried `ui-color-palette:uicper`), so AgentDeck takes subagent types from `SubagentStart` only | hooks § Common input fields | spike S1 | — |
| Stop / SubagentStop | `last_assistant_message`, `stop_hook_active`, `background_tasks` | hooks § Stop input | spike S1 | — |
| TaskCreated / TaskCompleted | `task_id`, `task_subject`, `task_description` | hooks § TaskCreated input | spike S1 | — |
| PostToolUseFailure | `error`, `is_interrupt`, `duration_ms` | hooks § PostToolUseFailure input | spike S1 | — |
| Notification | `notification_type` ∈ permission_prompt, idle_prompt, elicitation_dialog, elicitation_url_dialog, agent_needs_input, agent_completed, quota_auto_resume_*, … | hooks § Notification | docs | docs |
| StopFailure | `error` ∈ rate_limit, overloaded, authentication_failed, oauth_org_not_allowed, account_on_hold, billing_error, invalid_request, model_not_found, server_error, max_output_tokens, cloud_credential_error, unknown | hooks § StopFailure input | docs | docs |
| PermissionDenied | auto mode only; `reason` | hooks § PermissionDenied | docs | docs |
| PreCompact / CwdChanged | `trigger`; `old_cwd`/`new_cwd` | hooks | docs | docs |
| Hot reload | settings watcher applies `hooks` edits to running sessions | settings § When edits take effect | **unverified (M3)** | unverified |
| Dedupe | the same handler in several files runs once | hooks § Hook handler fields | docs | docs |
| Trust gate | interactive sessions hold back settings hooks until trusted | hooks § Workspace trust | docs | docs |
| `disableAllHooks`, `allowedHttpHookUrls`, `httpHookAllowedEnvVars` | Diagnostics conflict checks | settings-reference § Hooks and automation | docs | docs |
| Exec-form command hook | `command` + `args`, needs a real `.exe` on Windows | hooks § Exec form and shell form | docs (not used in v1) | — |

## Session registry (`claude agents`)
| Interface | What AgentDeck relies on | Source | 2.1.318 |
|---|---|---|---|
| `--json --all` | JSON array, no TTY needed | agent-view § List sessions as JSON | live |
| Interactive rows | `pid,cwd,kind,startedAt,sessionId,name,status` (no `id`/`state`); `startedAt` is epoch ms | live run | live |
| `-p` runs | listed while running as `kind:"interactive"`, `status:"busy"`, with a generated `name` (e.g. `scratch-bc`); the row disappears on exit | live M2 run | live |
| Background rows | adds `id`, `state` ∈ working, blocked, done, failed, stopped | agent-view § Read session state | spike S7 (blocked, done, stopped, failed) |
| `waitingFor` | `permission prompt` seen (background and interactive rows), `input needed` seen on an interactive row; `dialog open`, `sandbox request`, `worker request` docs-only | agent-view table | spike S7 + live M2 + docs |
| Surfaces | CLI ✓, Claude Desktop ✓ (from the pid's exe path, D-045), `--bg` ✓, VS Code ? | live run | live / **VS Code unverified** |
| Disabled agent view | `disableAgentView` / `CLAUDE_CODE_DISABLE_AGENT_VIEW` | agent-view § Turn off agent view | docs |
| Untrusted cwd | `--json` runs without a prompt | spike S6 | spike |
| Cost | 312 ms CPU p50 per call | spike S5 | spike |

## Background sessions and lifecycle CLI
| Interface | Source | 2.1.318 |
|---|---|---|
| `claude --bg [--name n] [--agent a] [--model m] [--effort e] "<prompt>"`, prints `backgrounded · <id>` | `claude --help`, agent-view § Dispatch | spike S6/S7 (`--name`, `--model`) |
| `--bg` with `-p` is rejected | agent-view § Dispatch | docs |
| `Workspace not trusted. Run \`claude\` in <path> once and accept the trust prompt, then retry.` (exit 1) | errors index, spike S6 | spike |
| `claude logs <id>` (ANSI screen dump) | cli-reference | spike S7 |
| `claude stop|kill <id>`, `claude rm <id>` | cli-reference | spike S7 |
| `claude attach <id|name>` ("Open the background session in this terminal") | cli-reference, `claude attach --help` | docs (help text); a real attach is still to run by hand. The console window it opens in without Windows Terminal was probed (D-095) |
| `--agent <name>` takes built-in and custom subagents | sub-agents § Invoke subagents explicitly (page summary) | docs (summary, not verbatim) |
| `@agent-<name>` in a prompt invokes that subagent | sub-agents § Invoke subagents explicitly (page summary) | **unverified**: run one mention by hand |
| Project `.claude/agents` beats `~/.claude/agents` on a name clash | sub-agents § Choose the subagent scope | docs |
| `claude respawn <id>` | cli-reference | docs (not used) |
| `--effort` ∈ low, medium, high, xhigh, max (+ `ultracode`) | `claude --help`, cli-reference | docs |
| `claude --resume <sessionId>` | sessions § Resume by session ID | docs |
| `claude --desktop --resume <id>` | `claude --help` ("Open in the Claude Desktop app instead of the terminal (with --continue or --resume <id> to pick the session)") | docs (help text); not run against a Desktop session yet |

## OpenTelemetry
| Interface | Source | 2.1.318 |
|---|---|---|
| `OTEL_EXPORTER_OTLP_PROTOCOL=http/json` + per-signal endpoints | monitoring-usage § Common configuration variables | spike |
| Default temporality DELTA | monitoring-usage | spike (`aggregationTemporality:1`) |
| Metric names and attributes (session.count, cost.usage, token.usage, active_time.total, lines_of_code.count, commit.count, pull_request.count, code_edit_tool.decision) | monitoring-usage § Metrics | spike (first 4) / docs |
| Log events (api_request, api_error, tool_decision, tool_result, user_prompt, …) | monitoring-usage § Events | spike (api_error docs-only) |
| Vars ignored in repo/local settings | monitoring-usage § Administrator configuration | docs |
| Vars read at startup only | env-vars § Set variables in settings files | docs |
| Receiver down: silent (debug log only) | spike | spike |
| "Cost metrics are approximations" | monitoring-usage § Cost monitoring | docs |

## Settings and files
| Interface | Source | Status |
|---|---|---|
| User settings `~/.claude/settings.json` (`%USERPROFILE%\.claude` on Windows); `CLAUDE_CONFIG_DIR` moves settings, history and plugins | settings § Settings files, env-vars | docs |
| `env` block applies live, except startup-only consumers (OTel) | env-vars § Set variables in settings files | docs |
| Subagents in `~/.claude/agents`, `.claude/agents`, plugin `agents/` (frontmatter `name`, `description`, `model`, `color`, …) | sub-agents § Choose the subagent scope | live (346 user agents) |
| `~/.claude/jobs/*` is **not stable**, never read. Transcript JSONL is not stable either; its content is never read, and the one opt-in exception is the next row | agent-view § List sessions as JSON; sessions § Where transcripts are stored | docs |
| Session logs `<config dir>/projects/**/*.jsonl`, read only with `usage.readLogs` (ADR-0009 Amendment): per `type:"assistant"` row, `timestamp`, `message.model`, `message.id`, `requestId` and `message.usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `cache_creation.ephemeral_1h_input_tokens`, `speed`, `inference_geo`, `service_tier`). A streamed message is written several times with the same usage; the first copy counts, a later copy with a larger `output_tokens` replaces it. Subagent (`isSidechain`) rows are separate requests and count | internal format (sessions § Where transcripts are stored) | **live 2.1.323**, read-only probe: 280 files and 2.1 GB modified in 8 days, 63,180 assistant rows, 55% repeats of an earlier row (35,052 with equal usage, 5 with a larger output), lines up to 2.3 MB, every row `standard` speed and `global` region |
| Prices for the cost estimate (`usage-price.ts`): per model, input, 5-minute and 1-hour cache write, cache read and output per MTok; Claude Haiku 5.5 is priced by prompt size (up to or over 100,000 tokens); fast mode and US-only inference change the price, so those requests get no cost | platform.claude.com/docs/en/about-claude/pricing, read 2026-11-13 | **verified**: the table reproduces Claude Code's own `cost.usage` ($0.00139164) for a real claude-haiku-5-5 request, with cache writes at the 1-hour rate |
| `CLAUDECODE` / `CLAUDE_CODE_CHILD_SESSION` hide nested sessions from `claude agents` | env-vars | docs |

## macOS
What the macOS build relies on that Windows does not. **CI** means the darwin branch runs in the unit tests on a `macos-latest` runner with the OS call faked; none of these rows has been observed on a real Mac yet.

| Interface | What AgentDeck relies on | Source | Status |
|---|---|---|---|
| Native installer path | `~/.local/bin/claude`, tried first | Claude Code setup | CI; unverified on a Mac |
| `PATH` of a Dock-started app | bare (`/usr/bin:/bin:/usr/sbin:/sbin`), so main asks `$SHELL -ilc` once (3 s timeout, markers around `$PATH`, CLAUDE* scrubbed) before the collector starts; falls back to the bare one silently | macOS launchd behaviour | CI; unverified on a Mac |
| `/usr/bin/which -a claude`, then `/opt/homebrew/bin/claude`, `/usr/local/bin/claude` | npm's global prefix under Homebrew (Apple silicon) and the nodejs.org installer | npm, Homebrew defaults | CI; unverified on a Mac |
| Claude Desktop's own copies skipped | anything under `/Claude.app/` or `~/Library/Application Support/Claude/` | a guess from the Windows layout (F1) | **unverified**: the real Desktop layout on macOS has not been seen |
| `ps -o pid=,comm= -p <pids>` | prints each live pid with its executable path; exits 1 when one pid is gone | ps(1) | CI (parsing); unverified that `comm` is the full path for every launcher |
| Answer in terminal | `ps -axo pid=,ppid=,comm=` walks up to the outermost `.app`, then `open -a <bundle>` | ps(1), open(1) | CI; unverified on a Mac. Brings the app forward, not the tab |
| Attach, Terminal here, run claude for the trust prompt | `osascript` with the command as `argv`: Terminal `do script`, or iTerm `create window with default profile` + `write text` when `/Applications/iTerm.app` exists. Needs the Automation consent and `NSAppleEventsUsageDescription` | Terminal and iTerm AppleScript dictionaries | CI (argument building, quoting); unverified on a Mac |
| VS Code and Cursor | `code` / `cursor` on `PATH`, else the bundle's `Contents/Resources/app/bin/<tool>` in `/Applications` or `~/Applications` | VS Code § Launching from the command line | CI; unverified on a Mac |
| Console stop | the child is a process-group leader (`detached`); `kill(-pid, SIGTERM)` then the child | POSIX | CI (fake kill) |
| Dock badge, menu bar icon, window chrome | `app.dock.setBadge`, `trayTemplate.png` (+@2x), `titleBarStyle: 'hiddenInset'` with `trafficLightPosition`, an app menu with the standard roles | Electron API docs | docs; unverified on a Mac |
| Start minimized at login | `getLoginItemSettings().wasOpenedAtLogin` (the `--hidden` argument is Windows-only) | Electron API docs | docs; unverified, may be false on newer macOS login items |
