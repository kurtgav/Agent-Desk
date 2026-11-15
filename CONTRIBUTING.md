# Contributing to AgentDeck

Thanks for looking. AgentDeck is a small Windows tray app with a strict privacy stance, so this guide is mostly about what keeps it trustworthy. Please read [the three invariants](#the-invariants-do-not-break-these) before you write code.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through [SECURITY.md](SECURITY.md), not a public issue.

## Dev setup

You need Windows 11, Node 24 and Claude Code on your `PATH` (or in `%USERPROFILE%\.local\bin`). AgentDeck is Windows-only in v1.

```powershell
git clone https://github.com/kurtgav/Agent-Desk.git
cd Agent-Desk
npm ci
npm run dev
```

`npm run dev` starts Electron against the Vite dev server. The **Third Code** menu has a **Demo data** switch: sample sessions that never touch your real `~/.claude`. Use it for UI work.

To try real hook traffic without installing anything into your own settings, point the scratch project at the running app:

```powershell
npm run scratch:hooks     # writes spikes/scratch/.claude/settings.local.json (git-ignored, holds your token)
cd spikes\scratch
claude -p --model haiku --setting-sources local "list the files here"
```

### The checks

```powershell
npm run check
```

That runs, in order, `typecheck`, `lint` (zero warnings allowed), `test` (Vitest, unit and integration) and `test:smoke` (builds the app, then Playwright drives the real Electron window). CI runs the same on `windows-latest`, and also builds the unpacked app with `npm run pack`. A pull request needs all of it green.

Notes:

- The smoke tests open a 1440x924 window, so you need a screen at least that large. CI switches the runner to 1920x1080 first.
- Smoke tests point `CLAUDE_CONFIG_DIR` at a temporary profile, so they install and remove hooks without touching your real `settings.json`. Keep it that way for any new test.
- `npm run test:smoke` and `npm run pack` write to `out/`. Do not run them while another one is running.
- Unit tests live next to the code as `src/**/*.test.ts`. A bug fix comes with a test that fails without it.

### Building the installer

```powershell
npm run pack     # unpacked app in release/
npm run dist     # NSIS installer in release/
```

Packaging is configured in `electron-builder.yml` and `build/installer.nsh` (see [ADR-0012](docs/adr/0012-packaging.md)). Releases are made by a maintainer pushing a `v*` tag; the release workflow does the rest.

When you add or update a dependency that the app bundles, regenerate the licence file that ships in the installer: `node scripts/make-notices.mjs`.

## The invariants (do not break these)

These are the product's promise to the people who install it. A change that weakens one will not be merged, however useful it is.

1. **No network.** AgentDeck listens only on `127.0.0.1` and makes no outbound request. No telemetry, analytics, crash reporter, update check, remote font, CDN script or "phone home" of any kind. ([ADR-0009](docs/adr/0009-supported-interfaces-only.md), [ADR-0010](docs/adr/0010-security-model.md))
2. **No model calls of AgentDeck's own.** Summaries, the "asked you a question" flag, the daily report and everything else come from deterministic rules over data AgentDeck already holds. The Composer and the Console start the user's own signed-in Claude Code, which does the work; AgentDeck itself never calls a model or Anthropic, and never reads credentials. ([STATE_MACHINE § 4](docs/STATE_MACHINE.md), ADR-0009)
3. **Never auto-approve.** A permission request is answered only by an explicit click in the AgentDeck window, for that one request. No timers that answer, no "always allow", no bulk approve, no rule creation (`updatedPermissions` is never sent). The only thing AgentDeck does without a click is give the request back to its terminal. ([ADR-0006](docs/adr/0006-remote-approvals.md))

Rules that follow from them:

- **Supported interfaces only.** Read hook bodies, `claude agents --json --all`, `claude logs`, and the few files listed in ADR-0009. Never transcripts, `~/.claude/jobs`, `~/.claude.json` or credentials.
- **One writer of `settings.json`.** Only the main process, through the installer in `src/main/hooks*.ts` and `settings-writer.ts`. It edits as text splices, backs up first, and touches only AgentDeck's own entries ([ADR-0005](docs/adr/0005-hook-install-lifecycle.md)).
- **Trust boundary.** The renderer is sandboxed, has no Node and no token. Every IPC handler checks the sender and parses its arguments with zod. Spawn processes with argument arrays and the scrubbed environment ([ADR-0008](docs/adr/0008-cli-resolution-env-scrub.md)). Treat every string from a session (commands, paths, messages) as untrusted text.
- **Redact before you store or show.** New event fields go through `src/collector/redact.ts`. A new secret shape gets a case in `normalize.test.ts`.
- **No dead controls, no invented numbers.** Every control maps to real data or a real action, and every number on screen is measured from real data.

## Branches, commits, pull requests

- Branch from `main`: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`.
- Commit messages are `<type>: <description>` or `<type>(<scope>): <description>`, lower case, imperative. Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`. Scopes follow the code: `collector`, `main`, `renderer`, `home`, `test`. Add a body when the why is not obvious.
- Keep a pull request to one change. Fill in the template, and say how you checked it.
- Behaviour that users can see goes in `CHANGELOG.md` under `Unreleased`.

## Recording decisions

The project keeps its reasoning in the repo, so the next person does not have to guess.

- **Small choices** (a default, a threshold, a wording rule) are a new row at the bottom of the table in [docs/DECISIONS.md](docs/DECISIONS.md): the next free `D-nnn`, the decision, and why, with the source of the why (a doc section, a spike, a review finding). Keep the table in order. To change an old decision, edit its row and note the new value and date.
- **Larger choices** (a new process, storage, a security boundary) are an ADR in [docs/adr](docs/adr): `NNNN-short-title.md` with Status, Context, Decision and Consequences. Look at ADR-0010 for the tone.
- **New risks** go in [docs/RISKS.md](docs/RISKS.md) with likelihood, impact, mitigation and status.
- **Anything that depends on Claude Code's behaviour** goes in [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) with its source and how it was verified: a spike, a live run, the docs only, or unverified. Say "unverified" when it is. Re-check this file when Claude Code ships a minor version.

## Fixtures and redaction

Tests use captured Claude Code payloads, and a captured payload can carry personal data. Before you commit one:

1. **OTLP captures** hold account identifiers on every signal (`user.email`, `user.account_uuid`, `user.account_id`, `organization.id`, `user.id`) and prompt text. Run `node spikes/redact-fixtures.mjs`. It replaces those values and exits non-zero if an email-like string is left.
2. **Hook payloads** carry no account data, but they do carry local paths (`transcript_path`, `cwd`, file paths) and session ids. Replace your Windows user name and any private folder names, for example `C:\Users\you` becomes `C:\Users\user`, and check with `git grep -n -i "<your user name>"`.
3. Never commit raw debug logs or `spikes/out/` (it is git-ignored for that reason), `config.json`, `settings.local.json` or anything with a real token. The placeholder token in the spike tooling is `spike-token-0001`.
4. Fixtures that are written by hand from the docs are labelled `docs-derived`.

## Reporting bugs and asking for features

Use the issue templates. For a bug, open **Settings, Diagnostics, Copy diagnostics** and paste the result: it holds the versions and checks that usually explain the problem and contains no session content. Look it over before you post it.
