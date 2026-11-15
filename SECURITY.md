# Security policy

AgentDeck runs next to your Claude Code sessions and can relay permission decisions, so security reports are taken seriously.

## Reporting a vulnerability

Please report privately. Do not open a public issue.

1. Go to the repository's **Security** tab and choose **Report a vulnerability** (GitHub private vulnerability reporting).
2. Say what you found, which version, and how to reproduce it. A proof of concept helps. Do not include real tokens or private data from your machine.

I (the maintainer, [@kurtgav](https://github.com/kurtgav)) aim to acknowledge a report within 7 days and to say within 30 days whether it is accepted and how it will be handled. This is a one-person project, so those are targets, not guarantees. Fixes ship as a new release, with credit if you want it.

## Supported versions

| Version | Supported |
|---|---|
| Latest release | Yes |
| Anything older | No: update to the latest release |

AgentDeck 0.1.0 is the first release. Only the latest version gets fixes.

## What AgentDeck promises

These are design rules, so a violation of one is a security bug:

- It binds only to `127.0.0.1` and makes no outbound request.
- It makes no model calls of its own. Sessions you start from AgentDeck (the Composer and the Console) run through your own signed-in Claude Code, exactly as if you had typed them in a terminal.
- It never answers a permission request without an explicit click in its window.
- It never reads the content of transcripts, `~/.claude/jobs`, `~/.claude.json` or credentials. The one exception is an opt-in switch (`usage.readLogs`, off by default) that reads token counts only from Claude Code's session logs: a time, a model, four numbers and two ids per message. A prompt, a reply, a tool's input or output or a file's contents are dropped in memory and never stored, logged or sent, and reading any of them is a security bug. ([ADR-0009, Amendment](docs/adr/0009-supported-interfaces-only.md))
- It changes only its own entries in `~/.claude/settings.json`, after you accept a diff, and backs the file up first.

## Threat model in short

The full text is [ADR-0010](docs/adr/0010-security-model.md); [ARCHITECTURE § 8](docs/ARCHITECTURE.md) summarises it.

- **Endpoint.** The collector accepts a request only if its `Host` is exactly `127.0.0.1:<port>`, it carries no `Origin` header (browsers always send one on cross-origin POSTs, so a web page cannot reach it, and DNS rebinding is blocked), and it carries the per-install 256-bit token in `X-AgentDeck-Token`, compared in constant time. Bodies are capped at 1 MB.
- **Token.** It lives in `%APPDATA%\AgentDeck\config.json` and in AgentDeck's hook entries in `settings.json`. **A process running as the same Windows user can read it.** This is accepted: such a process could already edit `settings.json` or run `claude` itself.
- **Approvals.** Approve and Reject come only from AgentDeck's own window, through an IPC call that checks its sender ([DECISIONS D-076, D-106](docs/DECISIONS.md)). There is no HTTP route that approves. Approve is once-only and never adds permission rules.
- **Renderer.** Sandboxed, context-isolated, no Node, no token, strict CSP, navigation and `window.open` denied. Session content (commands, paths, messages) is rendered as text. Every IPC handler checks the sender and validates its arguments.
- **Data.** Secrets are masked by pattern before storage. Everything stays under `%APPDATA%\AgentDeck`.

## In scope

- Any way for a web page, another machine, or another Windows user to reach the collector or approve something.
- Any way to make AgentDeck approve, reject or stop something without the user's click.
- Bypassing the `Host`, `Origin` or token checks.
- Escaping the renderer sandbox, or XSS from session content.
- Command or argument injection through anything AgentDeck passes to `claude`, `code`, `where.exe` or PowerShell.
- Corrupting or leaking `settings.json`, or touching entries that are not AgentDeck's.
- A secret that reaches the database, a log, a toast or the screen unmasked, in a shape the documented redaction rules claim to cover.
- Any outbound network traffic from AgentDeck.

## Out of scope (known and accepted)

- A local process running as the same user reading the token or the database ([R11](docs/RISKS.md)).
- A secret in a shape no redaction rule knows. Redaction is pattern-based and said to be ([R32](docs/RISKS.md)). A new shape is a normal bug report.
- Leftover hook entries after AgentDeck crashes, until its next launch ([R2](docs/RISKS.md)).
- Problems in Claude Code itself, Windows, or Electron's upstream code. Report those to their owners. If AgentDeck's use of one is the problem, report it here.
- The v1 installer being unsigned, so SmartScreen warns. This is documented in the README.
- Denial of service by a local process that floods the loopback port with a valid token.
