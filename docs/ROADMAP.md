# Roadmap

No dates. Each milestone has an exit test; a milestone is done when its gates in `QUALITY.md` are green.

## Shipped

- **M1 to M5**: the tray app, live data from Claude Code's hooks, the attention engine and notifications, remote approvals with an audit log, the Composer, lists and drawers, Settings and Diagnostics.
- **M5.5**: Tasks and the daily report (live), light and dark themes, mascot avatars, real notifications with the bot, usage figures (telemetry and an opt-in local-log source), the Claude link, the Console, "Answer in terminal" that takes you to the window, installer verified end to end.

## M6: session-first shell (in progress)

Build `docs/IA.md`: one session list, the open session in the middle, one composer, a Details panel, every agent visible. Right-click menu on every session. Exit test: a first-time user starts a session and finds an approval, a task and the daily report without help; all Electron specs pass in both themes.

## M7: roles and @mentions (in progress)

All ~299 agency-agents personas plus built-in leadership roles (CTO, Founding Engineer, Principal Engineer, VP of Engineering, Head of Product, Head of Marketing, Head of Design) and your own custom roles, as a catalog, in the sidebar, and through `@` in every composer. Exit test: `@cto` and `@qa` resolve in one keystroke; a session started as a role runs as that role on a real Claude Code.

## M8: reliability and performance hardening

Error boundaries and recovery screens, the memory budget (R52: 438 MB measured against a 300 MB target), the no-network test, parser fuzzing, visual regression, dark-theme smoke in CI, coverage report. Exit test: every row of the PR gates table is shipped.

## M9: open-source launch kit

Decide the name (see the naming note in `docs/launch/CHECKLIST.md`), code signing, provenance and SBOM, a `winget` manifest, a docs site, `GOVERNANCE.md`, starter issues, the launch posts. Exit test: a stranger can find it, trust the download, install it, and contribute a fix from the docs alone.

## macOS build (in progress)

The same app as a dmg for Apple silicon and Intel (ADR-0012 Amendment): login-shell `PATH`, `ps` for process paths, Terminal and iTerm through `osascript`, the Dock badge, a template menu bar icon, the traffic lights inset over the sidebar (D-162 to D-168). CI runs typecheck, lint, the unit tests and `electron-builder --dir` on `macos-latest`; the release adds the dmg and zip to the draft. Exit test: on a real Mac, install from the dmg, accept the hooks diff, see a live session, answer an approval, attach a background session in Terminal, and quit with `settings.json` left as it was.

## Compared with Synara

[Synara](https://www.trysynara.com) is an agent development environment. Its site, read in November 2026, shows what AgentDeck does not do yet. None of this is promised; each would need its own ADR, and some go against ADR-0009 (supported interfaces only, no LLM calls) or ADR-0010 (the collector binds to 127.0.0.1 only).

- **More than one agent runtime.** Synara runs Codex, Cursor and others beside Claude Code; AgentDeck reads Claude Code only.
- **A worktree per task.** Synara gives each task its own git worktree, so parallel agents never share a checkout.
- **Diff and PR review.** Review an agent's changes and open the pull request from the app. AgentDeck shows the files a session touched, not the diff.
- **Browser and terminal panels** beside the conversation.
- **Linux.**
- **Remote access** from another device, which ADR-0010 rules out today.

Closed in this round: a board lane for what waits on you (D-160, Synara's "Awaiting you"), and every agency role as a Claude Code skill on request (D-161).

## v1.0 criteria

M6 to M9 done; two weeks with no open P1 bug; the installer signed; `RISKS.md` has no open High.

## Later, not promised

Linux, a notarized macOS build, a plugin API, opt-in update checks, translations, MCP server add and remove forms, slash-command parity with the interactive CLI.
