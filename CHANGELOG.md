# Changelog

All notable changes to AgentDeck are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-13

First public release. Windows 11 only; the installer is not code-signed.

### Added

- Console: conversations with Claude Code started from AgentDeck (streaming, tool cards, follow-ups, stop, resume), through your own signed-in Claude Code. Text stays in memory.
- Light and dark themes with a one-click toggle and a system option.
- A mascot picture for every agent, and the AgentDeck bot on Windows notifications, with a test button in Settings.
- The Claude Code link in Settings: CLI and sign-in status (never an email), and opt-in usage figures from Claude Code's own telemetry.
- Tasks and the daily report update live: a task sent to an agent follows its session, and the report file is refreshed within about 30 seconds of a change.
- **Shell (M1).** Electron tray app with a custom title bar, single-instance lock, window bounds that persist, close-to-tray, and start at login. The renderer is sandboxed with a strict Content-Security-Policy and no Node. Home screen with a **Demo data** mode of sample sessions.
- **Live data (M2).** A collector in its own process listens on `127.0.0.1` (port 47821, falling back to 47822 to 47831) for Claude Code's HTTP hooks, protected by a per-install token and `Host` and `Origin` checks. Events are normalised, redacted and stored in SQLite (`node:sqlite`). `claude agents --json --all` is polled to discover sessions and read background state. Home shows running sessions, subagents, recent files and weekly numbers from real events.
- **Attention (M3).** One attention engine with four priorities: P1 needs approval or an answer, P2 failed or rate limited, P3 possibly stuck, P4 ready for review. Toasts, taskbar badge, tray status dot and taskbar flash, with a pause and quiet hours. A hook installer that shows a diff before it writes, backs up `settings.json`, edits only AgentDeck's own entries as text, and removes them when AgentDeck quits.
- **Act (M4).** A session drawer with timeline, plan, files and final message; Attach, Stop, Open in VS Code and Open in Claude Desktop. A composer that dispatches background sessions with `claude --bg`, with a project picker, `@` subagent mentions, an agent picker and an effort level. Opt-in remote approvals that hold a permission request, with Approve once and Reject, a confirm step for risky commands, and an audit log. List pages for Sessions, Approvals, Files, Activity and Agents, and a Ctrl+K palette.
- **Tasks.** Your own to-dos shown next to live agent work.
- **Daily report.** A markdown report for each day with agent time, sessions, files changed, approvals answered, tasks done and what still waits on you.
- **Settings and Diagnostics (M5).** Profile name and photo, notification and report settings, and a Diagnostics view with a Copy diagnostics button.
- **Packaging.** A per-user NSIS installer (`AgentDeck-Setup-<version>.exe`, no admin rights) built with electron-builder, a release workflow that publishes it with a SHA-256 checksum, CodeQL scanning, and Dependabot.

### Security and privacy

- Loopback only, no outbound requests, no model calls of its own, and no transcript reads. Approvals are never automatic.
- Secrets are masked by pattern before storage, and account identifiers in OpenTelemetry data are dropped at ingest.

### Known limits

- The installer is unsigned, so Windows SmartScreen shows a warning on first run.
- Windows 11 only. No macOS or Linux build, and no automatic updates.
- VS Code sessions and Claude Desktop hooks have not been verified against real sessions yet (risks R8 and R9).
- What an interactive terminal prompt does while AgentDeck holds a remote approval is not verified yet (R34). Remote approvals are off by default.
- Redaction is pattern-based, so a secret in an unrecognised shape can be stored as typed (R32).

[Unreleased]: https://github.com/kurtgav/Agent-Desk/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/kurtgav/Agent-Desk/releases/tag/v0.1.0
