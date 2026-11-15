# ADR-0014: Other agent CLIs: watched through their own supported hooks, nothing else

- Status: Accepted, 2026-11-15 (extends ADR-0009 and ADR-0005)

## Context
- People run more than Claude Code: Codex CLI, OpenCode, Gemini CLI. The owner wants every one of them live in AgentDeck, the same way Claude Code sessions are (Sessions, Tasks, Needs you, Activity), and the project will be open source, so whatever it touches on someone else's machine must be easy to audit.
- Each CLI has its own supported hook system and its own private files. The private files (credentials, databases, transcripts) are exactly what ADR-0009 rules out for Claude Code.
- Codex CLI 0.162.1, captured in a scratch home (fixtures in `test/fixtures/hooks/codex-0.162.1/`):
  - Hooks live in `~/.codex/hooks.json`: `{"hooks":{"<Event>":[{"matcher"?,"hooks":[{"type":"command","command","timeout"}]}]}}`. There is no HTTP handler, only a command.
  - Codex asks the user to trust each hook command once (`/hooks`), and the trust is tied to the command's hash.
  - On Windows a command runs as `powershell.exe -NoProfile -Command "<cmd>"`, a child of `codex.exe`.
  - `SessionEnd` and `Interrupt` are capped at 3 s; a command to a closed localhost port costs about 2.1 s on Windows unless curl is told `--connect-timeout`.
  - `apply_patch` puts whole file bodies in `tool_input.command`.

## Decision
- **Scope.** The first slice watches; it does not drive. A session started in another CLI is shown, live, everywhere a Claude Code session is, and AgentDeck offers only what works without typing into it: open its folder, go to its window, copy its resume command. Starting, forking, holding approvals and Claude Desktop actions stay Claude Code only, refused in main with one plain sentence.
- **What is read, per CLI.** Only the hook bodies that CLI sends to AgentDeck's loopback collector. For Codex that is the documented events: SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, Stop, SessionEnd, Interrupt. Nothing is read from the CLI's home folder.
- **Never read**, extending ADR-0009's list: `~/.codex/auth.json` and anything else under `~/.codex/` except `hooks.json` (which is written, as below); `~/.local/share/opencode/` (`opencode.db`, `auth.json`); Gemini's OAuth or settings tokens; any API key or keychain entry. No outbound network, as before.
- **What is written.** Only the CLI's own hook file, with the same rules as ADR-0005: our entries are recognised by shape, every other byte of the file is kept, a backup comes first and the user sees the diff. For Codex that is `hooks.json` entries whose command posts stdin to the collector. AgentDeck never writes Codex's trust store (`.hook-trust/`): the user trusts the hooks in Codex's own `/hooks`.
- **The command carries no secret and no port.** The collector's URL and bearer token sit in a curl config file in AgentDeck's data folder (`hooks/codex.curlrc`, read by `curl -K`), so the trusted command stays the same across restarts and port changes, and the token never shows in a process list or in `hooks.json`. Each command ends `exit 0`, so a stopped AgentDeck never fails a Codex turn. On quit the curlrc is parked: port 0 and no token, so nothing is posted and no token sits in it while AgentDeck is closed.
- **Ingest.** Each CLI posts to its own route (`/hooks/codex`), under the same token check as `/hooks`. Its session ids are stored prefixed (`codex:<id>`), so they can never collide with Claude Code's, and `providerOf(id)` tells every layer which CLI a session belongs to. `apply_patch` bodies are slimmed at ingest to the file names and a size, so no file content is ever kept.
- **Liveness.** No other CLI has a poll like `claude agents`, so SessionStart sends the CLI's process id (the hook shell's parent) in a header, and the stall tick asks the OS whether that process still lives (`kill(pid, 0)`). A gone process ends the session.

## Consequences
- A session from another CLI looks and behaves like a watched Claude Code session, with a small mark and its CLI and model in the tooltip and header.
- Async hooks race: a PostToolUse can arrive before its PreToolUse, and a late PreToolUse can arrive after the PermissionRequest it led to. The reducer keeps a short list of finished calls, and the attention engine does not let those late events answer a question.
- Codex approvals show as "Answer in terminal" (P1, not held). Holding them, as remote approvals do for Claude Code, is a later slice.
- OpenCode and Gemini CLI each need their own route and installer under these same rules.
