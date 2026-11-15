# ADR-0009: Only supported interfaces: no transcript content, jobs files, credentials or LLM calls

- Status: Accepted, 2026-11-05 (brief non-negotiable, confirmed against the docs)

## Context
The docs mark both of these as internal:
- Transcript JSONL: "The entry format is internal to Claude Code and changes between versions" (sessions § Where transcripts are stored).
- `~/.claude/jobs/<id>/`: "not a stable interface" (agent-view § List sessions as JSON).

Hook payloads still include `transcript_path`, `agent_transcript_path` and `scratchpad_dir` (S1).

## Decision
- AgentDeck reads only:
  - hook bodies;
  - `claude agents --json --all`;
  - `claude logs <id>` output (display only);
  - OTLP bodies and Reporter bodies;
  - subagent definition files (`~/.claude/agents/*.md`, project `.claude/agents/*.md`, for name, description, model and color only);
  - `settings.json` (for install and Diagnostics);
  - the plan limits from Claude Code's status line input, once the user turns that on (Amendment 2 below).
- `transcript_path`, `agent_transcript_path` and `scratchpad_dir` are **dropped at ingest**, so nothing downstream can come to depend on them.
- AgentDeck never reads `~/.claude.json`, `.credentials.json`, keychain entries, OAuth tokens or API keys. The trust status of a folder is inferred only from the `Workspace not trusted` error text, or from the absence of hook traffic alongside a poll row.
- No LLM calls. Summaries and "asked a question" flags come from deterministic rules (STATE_MACHINE § 4).
- No network listeners except 127.0.0.1, and no outbound requests. Fonts and icons are bundled. Auto-update is off in v1.

## Consequences
- A few features degrade honestly. For example, there is no conversation preview beyond `last_assistant_message` and `claude logs`.
- A test asserts that the ingest pipeline drops the three path fields.

## Amendment (2026-11-13): an opt-in switch reads token counts from Claude Code's local logs

- **Status:** accepted by the product owner. This narrows the rule above to "never reads transcript content". It does not remove it.
- **Why:**
  - Claude Code reads its OpenTelemetry settings only when a session starts (ADR-0007), so a session that is already open never reports.
  - The Usage card could then only say "start a new session".
  - The session logs already hold the token counts of every message, for open sessions too.
- **The switch:** `usage.readLogs` in `config.json`, shown in Settings › Claude Code. It is **off for everyone** until they turn it on. While it is off, no log file is opened and no row is written.
- **Where it reads:** `projects/**/*.jsonl` under `CLAUDE_CONFIG_DIR`, `~/.claude` and `~/.config/claude` (each only if it exists). The first pass reads files modified in the last 8 days, in slices that give way to hook ingest. After that it follows new lines.
- **What it reads, per assistant message:**
  - the timestamp and the model name;
  - the four token counts: input, output, cache creation (and its 1-hour share), cache read;
  - the message id and the request id, which together make a streamed message count once;
  - the speed, region and tier fields, which decide whether a price is known.
- **What it does not read, keep, log or send:**
  - a prompt, a reply, thinking text, a tool's input or output, or a file's contents;
  - a working directory, a branch name, a session id or a session title.
  - A line is parsed in memory, those fields are copied into a record, and the line is dropped. Only the record goes on, to storage, and the figures derived from it to the window. No log line, and no text taken from one, reaches a log file, a message to main, or the window.
- **What it stores** (migration 6, apart from the OTel `usage` table, so the two sources are never added together):
  - one row per message in `usage_log`: key, time, model, the counts, one flag;
  - where reading stopped in each file in `usage_log_files`: its path, size, modified time, offset and a hash of its first 1,024 bytes.
  - Rows are kept for 30 days. With the switch on, the snapshot takes the log figures instead of the OTel ones.
- **Still never read:** `~/.claude/jobs`, `~/.claude.json`, credentials, keychain entries, OAuth tokens and API keys. `transcript_path`, `agent_transcript_path` and `scratchpad_dir` are still dropped from hook payloads.
- **Cost** is an API-equivalent estimate from a dated price table (`src/collector/usage-price.ts`). A model with no price counts its tokens and gets no cost, and the card says the cost is partly unknown.
- **The 5-hour window** on the card follows ccusage's rule (a block starts at the hour of the first message after a 5-hour gap). It is a guess at Claude's rolling window, because the plan's real limit is not readable from this PC.
- **Fragility:** the log format is internal ("changes between versions", sessions § Where transcripts are stored). A line that does not fit is skipped, never guessed at, and `usage-log.test.ts` pins the shape this was built against (Claude Code 2.1.323).
- **Test:** `usage-log-privacy.test.ts` feeds a transcript full of sentinel strings (prompt, reply, tool input and output, file contents, thinking, path, branch, title, an email address). It asserts that none of them reaches the database file, the snapshot, the collector's callbacks or the process output.

## Amendment 2 (2026-11-15): the plan's own limits, from Claude Code's status line

- **Status:** accepted by the product owner (D-172). The rules above stand: no credentials, no OAuth token, no network call.
- **Why:** the owner wants the figures claude.ai's Settings › Usage shows ("Current session 16% used, resets 2:10 PM"; "This week 23% used, resets Friday 1:00 PM"). AgentDeck cannot compute them, and the 5-hour estimate above is a guess. Claude Code passes exactly these to its status line command, a documented interface (code.claude.com/docs/en/statusline): `rate_limits.five_hour` and `rate_limits.seven_day`, each `{ used_percentage, resets_at }` (epoch seconds), for Claude subscribers, after a session's first reply.
- **The switch:** "Show my plan's session and weekly limits" in Settings › Claude Code. It is **off for everyone** until they turn it on, and the change to `settings.json` is shown as a diff first (ADR-0005 § 4, the same writer: backup, atomic write, validation).
- **What it writes:**
  - In `<userData>/statusline/`: AgentDeck's script (`agentdeck-statusline.ps1` on Windows, `.sh` on macOS and Linux); `previous.json`, the user's own `statusLine` object exactly as it was (or `null`); and that object's command as `previous-command.sh` and `previous-command.ps1`.
  - In `settings.json`: `statusLine` becomes `{ "type": "command", "command": <runs our script>, "refreshInterval": 60 }`, keeping the user's other keys (`padding`, `hideVimModeIndicator`) and a refresh interval shorter than 60. Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File "<script>"`, which Git Bash and PowerShell both run. macOS and Linux: `sh '<script>'`.
- **What the script does** each time Claude Code runs it: reads its input, saves `rate_limits` to `rate-limits.json` (a temp file, then a rename), then runs the user's previous command with the same input, through Git Bash when it finds one, else PowerShell, as Claude Code would, and prints what it prints. It swallows every error and exits 0, so it never blanks the status line. The PowerShell script saves `rate_limits` alone. The sh script has no jq to count on, so it saves its whole input (only when the input holds `rate_limits`); the collector reads `rate_limits` from it and nothing else.
- **What AgentDeck reads:** `rate-limits.json`, in the collector, when its modified time changes: the two windows' share used and reset time, and the file's modified time ("as of"). A window whose reset has passed is dropped. Nothing else from the status line input is read, kept, logged or sent to the window.
- **How to undo:** turn the switch off. AgentDeck puts `previous.json`'s object back (or removes `statusLine` if there was none), but only while the entry is still AgentDeck's; one the user set since stays as it is. It deletes `rate-limits.json`. `--uninstall-integration` (ADR-0012) does the same. Every write is backed up first.
- **Limits:** `disableAllHooks: true` also turns the status line off (the dialog says so). The status line runs only while a Claude Code session is open, so a figure ages when none is; the sidebar then says when it is from. Sessions run on an API key, Bedrock or Vertex get no `rate_limits`, and the sidebar keeps the estimate.
