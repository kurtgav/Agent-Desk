# M0 spike results

Environment: Windows 11 Pro 10.0.26100, 12 logical CPUs, Node 24.16.
- Claude Code CLI **2.1.318**, installed at `%USERPROFILE%\.local\bin\claude.exe`.
- Claude Desktop 4.16336, which bundles its own Claude Code **2.1.317** at `%LOCALAPPDATA%\Claude-Data\claude_*\claude-code\2.1.317\…\claude.exe`.

Date: 2026-11-05. Every run used `--model haiku` with all `CLAUDE*` env vars removed. `-p` runs also used `--no-session-persistence`. Total spend was about **$0.55**: one full-config `-p` run cost $0.17, three background sessions cost about $0.10 each, and the rest cost under $0.02 each.

Tooling lives in `spikes/`:
- `capture-server.mjs`: records request bodies and replies with a scripted answer.
- `run-p.ps1`: one cheap `-p` run.
- `s7-bg.ps1`: starts a background session and polls it.
- `redact-fixtures.mjs`. (`check-fixtures.mjs` became `src/collector/normalize.test.ts` in M2.)
- The scratch project's hook config is generated, not committed: `npm run scratch:hooks -- --capture` rewrites the exact S1 setup (port 47821, the spike token, PermissionRequest timeout 20 s).

Fixtures: the 54 S1 hook payloads moved to `test/fixtures/hooks/2.1.318/` in M2; `spikes/fixtures/otel/` holds 45 OTLP bodies. Raw stdout, stderr and debug logs are in `spikes/out/`, which is git-ignored because debug logs can contain account details.

---

## S1: payload capture (`spikes/scratch/.claude/settings.local.json`, 16 HTTP hook events)

The scripted run did Read, then Read of a missing file, Write, Edit, a shell command, an Explore subagent, and a task create/complete. It produced 28 requests, all `Content-Type: application/json`.

**Captured:** UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest (from S4), SubagentStart, SubagentStop, TaskCreated, TaskCompleted, Stop, SessionEnd.

**Not captured** (schema taken from the docs only):
- Notification: does not fire in `-p`.
- StopFailure: needs an API error.
- PermissionDenied: auto mode only.
- PreCompact: needs a long session.
- CwdChanged: the model did not `cd`.

Findings:
1. **Main-thread events carry `agent_type`, but never `agent_id`.** When the session runs under an agent, `agent_type` names it; this machine's user settings run every session as `ui-color-palette:uicper`. **Rule: an event is from a subagent ⇔ `agent_id` is present.**
2. Subagent tool events carry `agent_id` and `agent_type` (for example `"agent_id":"adb875602d90356fb","agent_type":"Explore"`).
3. The Explore subagent ran **async**. The Agent tool's `PostToolUse` arrived 18 ms after `PreToolUse`, with `tool_response = {"isAsync":true,"status":"async_launched","agentId":…}`. `SubagentStop` came about 15 s later. After that came a **synthetic `UserPromptSubmit`** whose `prompt` starts with `<task-notification>`. That is not a user prompt.
4. `TaskCreated` and `TaskCompleted` carry `task_id:"1"` (a small integer string, scoped to the session), `task_subject` and `task_description`.
5. `PostToolUseFailure.error` is free text, for example `File does not exist. Note: your current working directory is …`.
6. `effort.level` appears on tool and stop events. `prompt_id` appears on everything after the first prompt.
7. `transcript_path` is always present. AgentDeck drops it at ingest (ADR-0009).

## S2: endpoint down (latency and visibility)

Hook duration was measured inside Claude Code with OTel `hook_execution_complete.total_duration_ms`.

| Case | UserPromptSubmit | PreToolUse | PostToolUse | Stop | Result |
|---|---|---|---|---|---|
| Server up (4 sessions) | 148–530 ms (first hook of the session) | 13–24 ms | 11–139 ms | 5–31 ms | normal |
| Port closed | 57 ms | 16 ms | 6 ms | 4 ms | normal output; each hook `num_non_blocking_error=1` |

- A raw Node `net.connect` to a closed `127.0.0.1` port got `ECONNREFUSED` in **0–4 ms** (5 tries). Windows adds no retry penalty on loopback.
- **Visibility.** In `-p`, stderr printed exactly one line, for SessionEnd: `SessionEnd hook [http://127.0.0.1:47821/hooks] failed: connect ECONNREFUSED 127.0.0.1:47821`. The debug log has `[ERROR] Hooks: HTTP hook error: connect ECONNREFUSED …` for every event. Whether the interactive TUI shows a notice is still **unverified** (S7b).
- **Decision: a failure line reaches the user** (scripts and SDK hosts see it on stderr), so hooks are installed only while AgentDeck runs. See ADR-0005.
- With the server up, the first HTTP hook of each session took 148–530 ms. The capture server does trivial work, so this is warm-up inside Claude Code. M2 must measure ingest latency on the collector side separately (budget p95 < 20 ms).

## S3: slow endpoint
The server held `PreToolUse` for 5 s against `timeout: 2`. Claude Code cancelled the hook at **2018 ms** (debug log: `Hook PreToolUse:Read (PreToolUse) cancelled`), and the run finished normally. A slow collector therefore costs each event up to its timeout, so the collector must acknowledge before doing any work.

## S4: PermissionRequest replies (`-p`, `--permission-mode default`)
| Reply | Outcome | Next hook event |
|---|---|---|
| `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}` | command ran (`perm-allow` created) | `PostToolUse` with the **same `tool_use_id` as the preceding PreToolUse** |
| `… "behavior":"deny","message":"Rejected in AgentDeck"` | not run; the model quoted `Rejected in AgentDeck` | `Stop` (no Post/Failure event) |
| empty 200 | `-p` denies it: "mkdir … needs approval …" | `Stop` (no Post/Failure event) |

- Event order is `PreToolUse → PermissionRequest → (PostToolUse if allowed)`.
- `PermissionRequest` has **no `tool_use_id`**. It does carry `permission_suggestions`.

## S5: poll cost (`claude agents --json --all`, 20 runs, 5 live sessions)
- Wall time: p50 440 ms, p95 660 ms, max 752 ms.
- **CPU: p50 312 ms, p95 406 ms.**

On 12 logical CPUs that is about **0.87 % of the machine at a 3 s cadence, 0.17 % at 15 s, and 2.6 % at 1 s**. ADR-0004 sets the cadence from these numbers.

## S6: workspace trust (`claude --bg` from a non-TTY)
| Folder | Project or CLI settings with hooks | Result |
|---|---|---|
| scratchpad temp folder | none | started (`backgrounded · afc61673`) |
| new `D:\agentdeck-trust-spike` | none | started (`242a56b9`) |
| `spikes\scratch` | `.claude/settings.local.json` hooks | exit 1: `Workspace not trusted. Run \`claude\` in D:\PERSONAL\agentdeck\spikes\scratch once and accept the trust prompt, then retry.` |
| `D:\personal\agentdeck` | `--settings bg-hooks.json` | same error, naming `D:\PERSONAL\agentdeck` |

- `claude agents --json` works from an untrusted folder with no prompt.
- The message changes the path's case (`D:\PERSONAL`). AgentDeck must compare paths case-insensitively.
- Why only the hook-bearing runs were gated is unconfirmed. The user's terminal sessions run with `--dangerously-skip-permissions`, so trust was probably never recorded for these folders. AgentDeck matches the error text and shows the fix either way.

## S7: background session lifecycle (no hooks; folder from S6)
- First poll after `--bg` returned: `status=waiting state=blocked waitingFor=permission prompt`.
- `claude logs <id>` prints the TUI screen with ANSI codes, including the dialog (`Do you want to proceed? 1. Yes … 4. No`).
- After `claude stop`, the very next poll showed `state=stopped`, with no `pid` and no `status`.
- A session that failed to start (bad `--settings` path) shows `state=failed` and no `pid`.
- The sequential poll loop sampled every 360–450 ms.
- **S7b still open** (it needs the scratch folder trusted, or the M3 global install):
  - how long the status takes to flip after the prompt is answered in the terminal;
  - whether the terminal prompt is deferred while AgentDeck holds the hook (`capture-server.mjs mode=hold` is ready for this);
  - whether the TUI shows a hook-error notice when the endpoint is down.

## S8: surfaces listed by `claude agents --json`
- **CLI:** 3 Warp/PowerShell sessions. Their parent process is `powershell.exe`, and the exe is `~/.local/bin/claude.exe`.
- **Claude Desktop:** 2 sessions. The exe is the Desktop-bundled CLI started with `--output-format stream-json`, under a parent named `claude.exe` (the Desktop Electron app in `WindowsApps\Claude_*`). They appear as `kind: interactive`.
- **VS Code: unverified.** No VS Code Claude session was open.
- **`--bg`:** `kind: background` with `id` and `state`.

## OTel: http/json receiver (process env only, nothing written to settings)
- Per-signal endpoints `…/v1/metrics` and `…/v1/logs` worked with `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`.
- Metrics seen: `claude_code.session.count`, `cost.usage` (USD), `token.usage` (`type` = input, output, cacheRead or cacheCreation), `active_time.total` (`type=cli|user`). All have `aggregationTemporality: 1` (**DELTA**).
- Log events seen: `user_prompt`, `tool_decision` (**`tool_use_id`, `decision`, `source`**), `api_request` (`cost_usd`, token counts, `model`), `tool_result`, `hook_execution_start` and `hook_execution_complete`, `assistant_response`, `hook_registered`, `plugin_loaded`, `mcp_server_connection`, `managed_settings_resolved`.
- **Every signal carries `user.email`, `user.account_uuid`, `user.account_id` and `organization.id`.** These are dropped at ingest and were redacted from the fixtures.
- With the receiver down, the only trace is the debug-log line `[3P telemetry] First logs export: FAILED (connect ECONNREFUSED 127.0.0.1:47822)`. There was no stderr output and the 4.1 s run showed no added delay.

## Cleanup
- All 3 background sessions were stopped and removed with `claude rm`.
- No writes were made to `~/.claude/settings.json` or `~/.claude.json`.
- The empty folder `D:\agentdeck-trust-spike` is left behind. The tool sandbox blocks removing folders at the drive root, so it needs deleting by hand.
