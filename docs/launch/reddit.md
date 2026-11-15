# Reddit posts

Four separate posts, each written for its own audience. Do not cross-post the same text. Post them on different days, and answer every comment.

**Rules I could not read.** reddit.com refuses automated fetches from this tooling, so the current rules of each subreddit are unverified. What was confirmed, from third-party mirrors and directories only: r/ClaudeAI and r/ClaudeCode exist and are active; r/ClaudeCode shows a "Showcase" flair on project posts; r/ClaudeAI lists a "Built with Claude" flair. Before posting, open each subreddit's sidebar, rules and pinned posts and check:

- Is self-promotion allowed at all, and does it need a specific flair, a weekly or megathread, or mod approval (send modmail first if unsure)?
- Is there a posting-history rule (many subreddits expect you to take part in other threads, not only post your own project)?
- Are links in the body allowed, and are images or screenshots allowed?
- Is a Windows-only, free, open-source tool in scope?

If the rules say "megathread only", use that and skip the standalone post.

**Every post** discloses that you are the author, shows a real problem before the product, states the limits, and ends with one specific question. Edit the first-person lines so they match what really happened to you; none of the wording below invents an event, but you know your own story best.

---

## r/ClaudeAI (broad audience: people who use Claude Code, not only developers)

**Flair:** the one the mods designate for projects you made (check the list; see above).

**Title:** I made a free Windows app that shows which Claude Code session needs you (I'm the author)

**Body:**

I run several Claude Code sessions at once: terminal tabs, Claude Desktop, and sometimes a `--bg` run. The problem I wanted to fix is simple. One of them stops to ask permission, nothing tells you which one, and you only find out when you happen to look at the right window.

So I built AgentDeck, a tray app for Windows. It watches every Claude Code session on the PC and shows:

- a **Needs you** list, sorted by priority: needs approval or an answer, failed or rate limited, looks stuck, ready for review
- what each session is doing right now, and which subagent is running under it
- a Windows toast and a taskbar badge when something needs you
- optional **Approve / Reject** buttons for permission requests (off by default, approve-once, every answer logged)
- a daily report as a markdown file, and a Tasks page that puts your own to-dos next to the live agent work

What it does not do, on purpose: it listens on 127.0.0.1 only, makes no network requests and no model calls of its own, never reads the content of your transcripts (one opt-in switch, off by default, reads only token counts), and never approves anything on its own. Secrets are masked before anything is stored.

Honest limits: Windows 11 only. The installer is not code-signed (I don't have a certificate), so SmartScreen warns; the SHA-256 is on the release and it's MIT-licensed, so you can build it yourself. I haven't been able to test the VS Code extension or Claude Desktop's hooks on real sessions yet.

Repo: https://github.com/kurtgav/Agent-Desk

I'd like to know: which Claude Code setup do you run (terminal, Desktop, VS Code, background), and what would you want to be told about that you aren't today?

**First comment (post it yourself right away):**

A bit more on how it stays out of the way, since that is the first thing I would ask too. It adds its own entries to `~/.claude/settings.json` only after showing you a diff, backs the file up first, and removes the entries when you quit. The design notes and the threat model are in the repo (`docs/adr/0010-security-model.md`). If you try it and something looks wrong, "Settings, Diagnostics, Copy diagnostics" gives me what I need for an issue.

---

## r/ClaudeCode (developers using the CLI and hooks: lead with what you learned)

**Flair:** Showcase, if the sidebar confirms it.

**Title:** What I learned building a dashboard on Claude Code's HTTP hooks and `claude agents --json` (author, open source)

**Body:**

I built a local Windows tray app (AgentDeck) that watches all my Claude Code sessions and flags the one that needs me. It's MIT, loopback-only, and makes no model calls of its own. The notes from building it might help if you're wiring your own hooks, so here they are. Everything below was measured on Claude Code 2.1.318 on Windows 11.

- **HTTP hooks don't fire on SessionStart.** So sessions are discovered by polling `claude agents --json --all`, and hooks drive everything after that.
- **A slow hook endpoint costs you its whole timeout.** I held a PreToolUse for 5 s against `timeout: 2`: Claude Code cancelled it at about 2 s and carried on. The collector answers 200 with an empty body immediately and does its work afterwards.
- **A dead endpoint is cheap but visible.** With the port closed each hook became a non-blocking error costing 4 to 57 ms, and `-p` runs printed one stderr line (`SessionEnd hook [...] failed: connect ECONNREFUSED`). That's why AgentDeck only keeps its hook entries in `settings.json` while it runs.
- **`claude agents --json` is not free.** About 312 ms of CPU per call at the median. At a 3 s cadence that's roughly 0.9% of a 12-thread machine, so I poll every 3 s with the window visible and every 15 s hidden.
- **PermissionRequest** takes `hookSpecificOutput.decision.behavior` allow or deny. An empty reply in `-p` is a denial. There is no `tool_use_id` on the request, but the next PostToolUse carries the same `tool_use_id` as the preceding PreToolUse.
- **Subagent attribution:** an event is from a subagent exactly when `agent_id` is present. `agent_type` also shows up on the main thread when you run with `--agent`.
- **`claude --bg` refuses folders with project hooks** that aren't trusted yet (`Workspace not trusted`), so AgentDeck shows the CLI's own message and a button that opens `claude` there.

What I have **not** verified: what an interactive terminal prompt does while a PermissionRequest hook is being held. The docs imply it waits and then falls back to the normal dialog; I only confirmed the `-p` behaviour. Remote approvals are off by default for that reason.

Repo (spike notes are in `docs/SPIKES.md`, the compatibility matrix in `docs/COMPATIBILITY.md`): https://github.com/kurtgav/Agent-Desk

Question: has anyone seen how the TUI behaves while a PermissionRequest hook is held open? And are there hook events you wish had HTTP support?

**First comment:**

Download is on the releases page; the installer is unsigned, so SmartScreen will complain. I'm happy to be told the compatibility table is wrong for your version: the matrix marks every row as spike, live, docs-only or unverified, and corrections are the most useful thing you can send.

---

## r/electronjs (developers: lead with the architecture and the pitfalls)

**Title:** A tray app with a utilityProcess collector, node:sqlite and a sandboxed renderer: notes from building it (author)

**Body:**

I'm the author of AgentDeck, an MIT-licensed Electron tray app for Windows that watches Claude Code sessions. The architecture had a few choices I'd like feedback on, and a few pitfalls that cost me time.

**Layout:** main owns the window, tray, toasts and the one file it may write. A `utilityProcess` runs a `node:http` collector on 127.0.0.1 plus the SQLite store and every child process spawn. The renderer is sandboxed with context isolation and no Node, and it never gets a port or token.

**Decisions and pitfalls**

- The renderer can't talk to the collector directly. A fetch from a custom `app://` origin sends an `Origin` header, which the loopback server rejects on purpose (so no web page can reach it). Snapshots go collector, then main, then renderer over IPC instead.
- Storage is the built-in `node:sqlite`, so there is no native rebuild. It's still experimental in Node 24, so Electron is pinned exactly and a test runs the real module inside Electron.
- The CSP is sent as a response header by the `app://` handler. In dev, plugin-react's refresh preamble is an inline script that the CSP blocks, which leaves a blank window. I allow exactly those scripts by SHA-256 hash in dev only.
- Node's `detached: true` on Windows means `DETACHED_PROCESS`, so a console program gets no console at all. Windows Terminal or a hidden `Start-Process` is the way to open a real console.
- Playwright-Electron smoke tests run on `windows-latest`. The runner's default screen is smaller than my reference window, so CI runs `Set-DisplayResolution` first.
- Packaging is electron-builder NSIS, per user, no admin, unsigned in v1. A `customUnInstall` macro runs before electron-builder deletes the install folder, which is what lets the uninstaller call the app once to clean up.

Repo: https://github.com/kurtgav/Agent-Desk (decisions are logged in `docs/DECISIONS.md`, the process model is in `docs/ARCHITECTURE.md`)

Question: is a `utilityProcess` the right home for a long-lived local server, or would you split it differently? And what bit you shipping an unsigned Windows installer?

**First comment:**

Happy to go into any of these. The decision log is long on purpose: each choice names the doc, spike or review finding behind it.

---

## r/opensource (people who care about licence, governance and trust)

**Title:** Open-sourced a local-first Windows tool for Claude Code users, with its decision log and threat model in the repo (author)

**Body:**

I'm the author of AgentDeck, a free, MIT-licensed Windows tray app that shows every Claude Code session on your PC and tells you when one needs you.

Why I'm posting here and not only in the Claude communities: the part I spent the most effort on is trust, and I'd like people who think about open-source hygiene to look at it.

- **Rules that can't be broken by a pull request:** no network (loopback only, no telemetry, no update check), no model calls of its own, and it never approves anything without a click. They're written down in `CONTRIBUTING.md` and enforced in review.
- **The reasoning is in the repo:** 13 ADRs, a decisions log with a row per default, a risk register that says what is not verified yet, and a compatibility matrix against Claude Code versions.
- **It touches a file that isn't yours:** it edits `~/.claude/settings.json` only after showing a diff, as text edits that change only its own entries, with a backup first.
- **What's missing:** Windows 11 only, an unsigned installer (SmartScreen warns; SHA-256 on the release), and one maintainer.

Repo: https://github.com/kurtgav/Agent-Desk

Question: you're the audience for the contributor docs, `SECURITY.md` and the threat model. What's missing, unclear, or more than you'd expect from a project this small?

**First comment:**

If you only read one file, read `docs/adr/0010-security-model.md`. It lists what is protected, what is accepted (a local process running as the same user can read the token), and why.
