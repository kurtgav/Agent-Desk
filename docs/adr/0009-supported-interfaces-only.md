# ADR-0009: Only supported interfaces: no transcripts, jobs files, credentials or LLM calls

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
  - `settings.json` (for install and Diagnostics).
- `transcript_path`, `agent_transcript_path` and `scratchpad_dir` are **dropped at ingest**, so nothing downstream can come to depend on them.
- AgentDeck never reads `~/.claude.json`, `.credentials.json`, keychain entries, OAuth tokens or API keys. The trust status of a folder is inferred only from the `Workspace not trusted` error text, or from the absence of hook traffic alongside a poll row.
- No LLM calls. Summaries and "asked a question" flags come from deterministic rules (STATE_MACHINE § 4).
- No network listeners except 127.0.0.1, and no outbound requests. Fonts and icons are bundled. Auto-update is off in v1.

## Consequences
- A few features degrade honestly. For example, there is no conversation preview beyond `last_assistant_message` and `claude logs`.
- A test asserts that the ingest pipeline drops the three path fields.
