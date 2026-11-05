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
| `claude attach <id|name>` | cli-reference | **unverified (M4)** |
| `claude respawn <id>` | cli-reference | docs (not used) |
| `--effort` ∈ low, medium, high, xhigh, max (+ `ultracode`) | `claude --help`, cli-reference | docs |
| `claude --resume <sessionId>` | sessions § Resume by session ID | docs |
| `claude --desktop --resume <id>` | `claude --help` | **unverified (M4)** |

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
| User settings `%USERPROFILE%\.claude\settings.json`; `CLAUDE_CONFIG_DIR` moves settings, history and plugins | settings § Settings files, env-vars | docs |
| `env` block applies live, except startup-only consumers (OTel) | env-vars § Set variables in settings files | docs |
| Subagents in `~/.claude/agents`, `.claude/agents`, plugin `agents/` (frontmatter `name`, `description`, `model`, `color`, …) | sub-agents § Choose the subagent scope | live (346 user agents) |
| `~/.claude/jobs/*` and transcript JSONL are **not stable**, never read | agent-view § List sessions as JSON; sessions § Where transcripts are stored | docs |
| `CLAUDECODE` / `CLAUDE_CODE_CHILD_SESSION` hide nested sessions from `claude agents` | env-vars | docs |
