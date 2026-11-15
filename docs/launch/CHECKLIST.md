# Launch checklist: AgentDeck v0.1.0

Work top to bottom. Nothing in this file has been run for you: every command below is for you to run, when you decide to.

## 0. Blockers: do not tag until these are closed

| # | Blocker | Why | Who |
|---|---|---|---|
| 0.1 | **`--uninstall-integration` does not exist in `src/main/index.ts`** (only `--hidden` is handled). | The NSIS uninstaller (`build/installer.nsh`) runs `AgentDeck.exe --uninstall-integration` and waits up to 10 s. Today that would start a full AgentDeck instance, and the uninstall would not remove the hook entries. Quit already removes them, so the harm is limited to uninstalling while AgentDeck is not running, or after a crash. It must remove only AgentDeck's own entries (hooks, and the OTel env keys if usage was enabled), print nothing to a window, and exit within seconds, even when no other instance is running. | code |
| 0.2 | **The packaged app has never been run.** `npm run pack` and `npm run dist` were not run here. | Check on the unpacked build: the collector starts (it is forked from inside `app.asar`; if it does not, set `asarUnpack: out/main/**` in `electron-builder.yml`), tray and badge icons load from `resources/`, a toast appears (AppUserModelID), the login item is set, the window opens. Then install the real installer on a clean Windows 11 machine or VM, and uninstall it (risks R19 and R29). | you |
| 0.3 | **Third-party design image in the repo.** `docs/reference/dashboard.png` is a screenshot of someone else's product design ("Fennel", a fictional user and email shown in it) and `docs/evidence/m1-side-by-side.png` embeds it. The MIT licence you publish under does not cover it. | Confirm you may redistribute it, or remove both files, `scripts/side-by-side.ps1`, and the references in `docs/UI_MAP.md` (first paragraph) and the comment in `src/renderer/src/styles.css`. Removing them from the tree does not remove them from history (see 0.5). | you |
| 0.4 | **A personal name is the default.** `Sidebar.tsx` has `USER_NAME = 'Kurt'` and the greeting tests expect "Kurt". Every new user would be greeted by your name. | The Settings work adds `DEFAULT_PROFILE_NAME = 'You'` in `src/shared/work.ts`. Check the final UI greets a fresh install neutrally. | code |
| 0.5 | **Decide the history questions** in the audit: 13 public commits carry a personal email as the committer address (`git log --format="%h %ce"` shows which), and the hook fixtures under `test/fixtures/hooks` contain your Windows user name in `transcript_path` values. | See the audit table in the report. Both are already public. Rewriting history means a force-push, and old clones and forks keep the data, so the usual answer is: accept it, scrub the fixtures going forward, and turn on "Block command line pushes that expose my email" in GitHub's email settings. | you |
| 0.6 | **Tasks, Daily report and Settings are finished**, and the README, CHANGELOG and posts still describe them correctly. | They were still being built when the README was written. Re-read the Features, Configuration and Quick start sections and the alt text in `x-thread.md` against the final screens. | you |
| 0.7 | **Screenshots exist** at the five paths the README uses (section 6). | Without them the README shows broken images. | you |

## 1. Merge the pull requests

Open PRs: #2 (M3, `feat/m3-attention` into `main`) and #3 (M4, `feat/m4-act` into `feat/m3-attention`), plus the Tasks, Daily report, Settings and release work on top.

1. Check CI is green on each, including the new `package` job, and that the `codeql` run finishes.
2. Merge #2 into `main`. Then retarget #3 to `main` (GitHub does this automatically if the branch is deleted on merge), rebase if needed, check CI again, and merge it.
3. Merge the release-preparation branch last.
4. `git switch main && git pull`, then run `npm ci && npm run check` once on the merged `main`.

## 2. Version, changelog and tag

`package.json` is already `0.1.0`. In `CHANGELOG.md`, set the date of the `0.1.0` heading to the release day. Regenerate the licence file and commit everything:

```powershell
node scripts/make-notices.mjs
git add -A
git commit -m "chore: release 0.1.0"
git push origin main
```

The tag must match `package.json` and the `CHANGELOG.md` heading, or the release workflow stops on purpose.

```powershell
git tag -a v0.1.0 -m "AgentDeck 0.1.0"
git push origin v0.1.0
```

The `release` workflow then runs typecheck, lint and tests, builds `AgentDeck-Setup-0.1.0.exe`, writes `SHA256SUMS.txt`, and creates a **draft** GitHub Release with both attached. Nothing is public yet.

## 3. Verify the draft before you publish it

- [ ] Download the installer from the draft (Releases, the draft, the asset), not from your build folder.
- [ ] `(Get-FileHash .\AgentDeck-Setup-0.1.0.exe -Algorithm SHA256).Hash` matches `SHA256SUMS.txt`.
- [ ] On a clean Windows 11 user profile: run it, go through SmartScreen (More info, Run anyway), confirm it installs without an admin prompt to `%LOCALAPPDATA%\Programs\AgentDeck`.
- [ ] Start a Claude Code session, install the hooks from the dialog, see the session appear, quit AgentDeck, and check `settings.json` is back to how it was.
- [ ] Uninstall from Windows Settings, Apps. Check no AgentDeck entries remain in `settings.json` (blocker 0.1) and that `%APPDATA%\AgentDeck` is still there (by design).
- [ ] Open the draft's notes and check they read well. Prepend the paragraph below if you want one.

Then click **Publish release**.

### Release notes: opening paragraph

> **AgentDeck 0.1.0** is the first release: a Windows 11 tray app that shows every Claude Code session on your PC and tells you which one needs you. It listens on loopback only, makes no network requests or model calls, and never approves anything by itself.
>
> The installer is **not code-signed**, so Windows SmartScreen will warn. Check the SHA-256 against `SHA256SUMS.txt`, or build it from source. VS Code sessions and Claude Desktop's hooks are not verified on real sessions yet; reports are welcome.

The rest of the notes (what was added, security, known limits) come from the `0.1.0` section of `CHANGELOG.md`, with the verify instructions appended by the workflow.

## 4. Repository settings (run these after the release is published)

Check the repo is `kurtgav/Agent-Desk` first. Topics are lower case, at most 20.

```powershell
# Description and topics
gh repo edit kurtgav/Agent-Desk `
  --description "Windows tray dashboard for Claude Code: shows which session needs you. Local only, no telemetry, never auto-approves." `
  --add-topic claude-code --add-topic claude --add-topic anthropic --add-topic electron `
  --add-topic windows --add-topic tray-app --add-topic developer-tools --add-topic local-first `
  --add-topic privacy --add-topic ai-agents --add-topic dashboard --add-topic hooks

# Discussions on (the issue templates link to it), wiki off, tidy merges, secret scanning
gh repo edit kurtgav/Agent-Desk --enable-discussions --enable-wiki=false --delete-branch-on-merge `
  --enable-secret-scanning --enable-secret-scanning-push-protection

# Private vulnerability reporting (SECURITY.md and CODE_OF_CONDUCT.md point to it)
gh api --method PUT repos/kurtgav/Agent-Desk/private-vulnerability-reporting

# Dependabot alerts and security updates (dependabot.yml handles version updates)
gh api --method PUT repos/kurtgav/Agent-Desk/vulnerability-alerts
gh api --method PUT repos/kurtgav/Agent-Desk/automated-security-fixes
```

At the time of writing, private vulnerability reporting was off, Discussions was off and `main` had no branch protection. Check the result in Settings afterwards.

Optional: protect `main` so it needs the `check` and `package` jobs to pass (no review requirement, since there is one maintainer):

```powershell
@'
{"required_status_checks":{"strict":true,"contexts":["check","package"]},"enforce_admins":false,"required_pull_request_reviews":null,"restrictions":null}
'@ | gh api --method PUT repos/kurtgav/Agent-Desk/branches/main/protection --input -
```

CodeQL: the repo has its own `codeql.yml`. If "Code scanning, default setup" is also on in Settings, switch it off, or the two will conflict.

**Social preview** has no CLI or API. In Settings, General, Social preview, upload a 1280x640 PNG under 1 MB (see section 6).

**Pin an issue.** Create one that asks for help with what is unverified, then pin it:

```powershell
gh issue create --repo kurtgav/Agent-Desk --title "Help wanted: verify VS Code and Claude Desktop sessions" --body-file docs/launch/pinned-issue.md
gh issue pin <number> --repo kurtgav/Agent-Desk
```

The issue text is in [pinned-issue.md](pinned-issue.md). Edit it if the unverified list has changed by then.

## 5. Order of launch day

Common advice, not measured for this project: post on a Tuesday to Thursday, in the morning in US Eastern time, and stay online for the next three or four hours to answer. Avoid Friday evening and weekends. Spread the posts over several days so each community sees a fresh, answered thread and not a wall of identical links.

1. **Day 0, morning:** release published and checked, README images in place, Discussions open, pinned issue up.
2. **Day 0:** the X thread ([x-thread.md](x-thread.md)), with the demo clip and the pinned reply.
3. **Day 1:** Show HN ([hn.md](hn.md)). Post the first comment immediately.
4. **Day 1 or 2:** r/ClaudeCode, then r/ClaudeAI ([reddit.md](reddit.md)), after you have read each one's rules.
5. **Day 3 or later:** r/electronjs and r/opensource, once you have fixed what the first threads found.

Do not ask for upvotes, stars or reposts anywhere, and do not ask friends to. Each post already ends with a real question.

## 6. Screenshots and the demo clip

| File | What to show | Size |
|---|---|---|
| `docs/images/home.png` | Home with a Needs you item, a running session with a subagent, files, agents | 1440x924 PNG (the window size the smoke tests use) |
| `docs/images/tasks.png` | Tasks with items in each state and one card showing a live agent | 1440x924 PNG |
| `docs/images/report.png` | The Daily report page for a day with real content | 1440x924 PNG |
| `docs/images/approvals.png` | An open approval with a risk flag, and the audit log below | 1440x924 PNG |
| `docs/images/settings.png` | Settings with Diagnostics visible | 1440x924 PNG |
| social preview | Product name, the one-line promise, a crop of Home | 1280x640 PNG, under 1 MB |
| demo clip | 15 to 25 s: two sessions running, one asks permission, the toast and badge appear, you click Approve, the session continues | MP4 for X and HN, 1280x720 or a 1200x760 crop; a GIF of the same under 5 MB for the README if you want one |

Keep each PNG under about 300 KB (the existing evidence images are 100 to 210 KB). Check every image for private project names, file paths and your Windows user name before you commit it.

If you use **Demo data**, leave the "Demo data" chip visible and say so in captions. AgentDeck's own rule is that sample numbers are never shown as real ones. If you use real sessions, use a scratch folder.

## 7. Reply templates

Edit them to sound like you. They only say what the docs prove.

**Does it send telemetry?**
No. AgentDeck makes no outbound requests at all: it listens on 127.0.0.1 and that's it. No analytics, crash reporter, update check or remote fonts, and the rule is written down in CONTRIBUTING.md and ADR-0009 so a pull request can't quietly change it. Claude Code itself still talks to Anthropic as it always did; AgentDeck is not part of that. If you'd rather check than trust me, block it in Windows Firewall and see that nothing changes, and tell me if it does.

**Does it auto-approve?**
No, and I won't add that. An approval needs a click in the AgentDeck window, for that one request. There is no "always allow", no bulk approve and no timer that answers, and AgentDeck never sends permission updates, so it can't add allow rules. The only thing it does without a click is hand the request back to the terminal when the wait runs out (60 seconds by default) or when you quit. Remote approvals are off by default. The design is ADR-0006.

**macOS or Linux?**
Not in v1. It's Windows 11 only today: the installer, toasts, the taskbar badge and the way it finds a session's process are Windows-specific, and nothing has been tested on anything else. The code avoids Windows-only APIs outside one folder, so a port is possible, but I'm not promising a date. If you want to help, open a discussion first.

**Is it signed?**
Not in v1. A signing certificate costs money every year and this project is free, so SmartScreen will warn. You can compare the installer's SHA-256 with `SHA256SUMS.txt` on the release, read the source, or build it yourself (`npm ci`, then `npm run dist`). I'll look at signing again once there's a way to do it that keeps the project free.

**Is it safe to let it edit my settings.json?**
It shows you a diff first (structure only, values hidden) and writes nothing until you accept. Every write is backed up (last 20 kept in `%APPDATA%\AgentDeck\backups`), it edits as text so formatting and other keys are untouched, and it removes only its own entries when you quit. If it crashes, its entries stay until the next launch, and each hook then costs a few milliseconds and prints one stderr line in `claude -p`. Details: ADR-0005 and risk R2.

**Why not just use Claude Code's Notification hook?**
That's the simple version, and it's a fine start. AgentDeck adds one queue across all your sessions and surfaces (terminal, Desktop, background), a priority order, the exact command being asked about, optional approve or reject, an audit log, and history. If a notification hook is all you need, use that.

**Does it work with VS Code / Claude Desktop?**
Desktop sessions are listed and shown live. Whether Desktop's bundled Claude Code runs the user-level hooks isn't verified (R8). The VS Code extension is detected from the process path, but I haven't seen it run (R9). If you try either, I'd like to know what you see: there's a pinned issue for it.

**Why Electron?**
A tray icon, toasts, a taskbar badge and a React UI in one runtime, and I know it. The budgets I set are under 300 MB of RAM and under 1% idle CPU (docs/ARCHITECTURE.md § 9). If you measure something worse, please open an issue with the numbers.

**Something broke.**
Thanks. Please open a bug report and paste "Settings, Diagnostics, Copy diagnostics" (read it first; it contains folder paths). I'll answer there.

## 8. After launch

- [ ] Triage every new issue within a day or two, even if only to say "seen".
- [ ] Turn good questions into FAQ entries in the README.
- [ ] Add each verified or disproved compatibility row to `docs/COMPATIBILITY.md` and close the matching risk in `docs/RISKS.md`.
- [ ] Update the R27 line in `docs/RISKS.md`: `npm audit` now reports 15 moderate findings, all the same `minimatch` advisory, because electron-builder pulls it in. It is build tooling and is not shipped.
- [ ] Put the next release's changes under `Unreleased` in `CHANGELOG.md`.

## Naming note (decide before the first big push)

A name check on GitHub and npm (2026-11-14) found that "AgentDeck" is taken in this exact space: `asheshgoplani/agent-deck` (about 1,250 stars, a terminal session manager for AI coding agents), `puritysb/AgentDeck` (about 300 stars, dashboards for AI coding agents), and the `agentdeck` name on npm is in use. "AgentDesk" has 27 repos, the largest `agentsea/agentdesk` (about 230 stars, desktops for AI agents). Searchers will land on someone else first. The repo is public with no stars, so renaming now costs almost nothing: GitHub redirects the old URL.

Candidates with weak competition on GitHub: **Quarterdeck** (22 stars at most; the deck where a ship is commanded, so it keeps the family feel), **Crewdeck**, **Wheelhouse**. Check each against a trademark search before committing. Rename the repo, the README, `package.json`, `electron-builder.yml` (appId and product name), the installer, the social preview and the docs in one change. Apply for code signing (SignPath Foundation's free open-source program) under the final name.
