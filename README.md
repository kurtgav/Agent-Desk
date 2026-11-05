# AgentDeck

A local Windows tray dashboard for every Claude Code session on this PC: what each one is doing, and when you need to step in. It observes sessions and relays your explicit decisions. It never auto-approves, makes no LLM calls, and sends nothing off the machine.

**Status:** M2 (live data). Home shows real sessions, subagents, files and KPIs from Claude Code's HTTP hooks and `claude agents --json --all`. Approvals and alerts arrive in M3, lists and actions in M4.

## Cost

AgentDeck itself costs nothing to run. It needs no account, cloud service, server or API key. Everything runs on your PC: the collector listens on 127.0.0.1 only, the database is a file in `%APPDATA%\AgentDeck`, and AgentDeck makes no model calls of its own. Every dependency is open source and runs locally. CI runs on GitHub Actions, which is free for public repositories. The only paid part is Claude Code itself, which you already use.

## Run

Windows 11, Node 24, Claude Code 2.1.31x on `PATH` (or in `%USERPROFILE%\.local\bin`).

```powershell
npm ci
npm run dev          # live mode; the switcher menu (Third Code ▾) has a "Demo data" toggle
```

AgentDeck does not touch `~/.claude/settings.json` yet (that is M3, behind your consent). Until then, sessions show up through the poll, and hook events can be tried in the scratch project:

```powershell
npm run scratch:hooks   # points spikes/scratch/.claude/settings.local.json at the running AgentDeck
cd spikes\scratch; claude -p --model haiku --setting-sources local "list the files here"
```

## Check

```powershell
npm run check   # typecheck, lint, Vitest unit + integration, Playwright-Electron smoke
```

## Docs

[Architecture](docs/ARCHITECTURE.md) · [ADRs](docs/adr) · [Event schema](docs/EVENT_SCHEMA.md) · [State machine](docs/STATE_MACHINE.md) · [UI map](docs/UI_MAP.md) · [Compatibility](docs/COMPATIBILITY.md) · [Decisions](docs/DECISIONS.md) · [Risks](docs/RISKS.md) · [Spikes](docs/SPIKES.md)

## License

[MIT](LICENSE)
