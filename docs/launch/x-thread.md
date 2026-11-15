# X thread

Voice: Kurt Gavin (Third Code), plain and specific. Every claim here is in the repo docs; the source is named in brackets for you, not for the post.

Post order matters: pain first, the demo next, privacy before the ask. Add the link in post 7 and in the pinned reply, not in post 1 (X shows link posts to fewer people). Each post is 280 characters or fewer; a URL counts as 23. The counts below were measured.

If your screenshots use Demo data, say "demo data" in the post or the alt text. AgentDeck's own rule is that sample numbers are never shown as real.

---

## 1/8 (230 chars)

If you run more than one Claude Code session, you know this one: a session stops to ask permission, nothing tells you which one, and it sits there while you stare at the wrong window.

I built a small Windows app for that. Thread:

## 2/8 (241 chars)

AgentDeck is a tray app that watches every Claude Code session on your PC (terminal, Claude Desktop, --bg) and puts the one that needs you first.

P1: approval or a question. P2: failed or rate limited. P3: looks stuck. P4: ready for review.

[sources: STATE_MACHINE § 3, SPIKES S8]

## 3/8 (174 chars) + image `docs/images/home.png`

Home shows what is running now, which subagent is under it, the files that changed, and a Needs you queue.

A Windows toast and a taskbar badge fire when something needs you.

**Alt text:** AgentDeck's Home screen. On the left, a sidebar with Home, Sessions, Approvals, Files and Activity. In the middle, a Needs you list with one approval waiting, a Running now list with two sessions and a subagent, and four numbers for the week. On the right, recent files and a grid of agents. (Say "Sample data" if the shot is from Demo data.)

## 4/8 (251 chars) + image `docs/images/approvals.png`

Optional remote approvals: Approve once or Reject from AgentDeck. Risky commands show in full behind a confirm. Every answer goes in an audit log.

Off by default. While it waits (60 s) the terminal prompt is deferred, then the terminal asks as usual.

**Alt text:** The Approvals page. At the top, an open permission request showing the exact command with Reject and Approve buttons. Below it, an audit log table with the time, session, what was asked, how long it waited and the outcome, such as "Approved once" or "Timed out: terminal asked".

[sources: ADR-0006, D-017, D-105, D-119]

## 5/8 (276 chars)

What I care about most. Loopback only, no outbound requests, no model calls of its own, never auto-approves, never reads the content of your transcripts (an opt-in switch reads token counts only).

Secrets are masked before anything is stored. The threat model is in the repo.

[sources: ADR-0009, ADR-0010, EVENT_SCHEMA § Redaction]

## 6/8 (179 chars) + images `docs/images/tasks.png`, `docs/images/report.png`

Also in there: a composer that starts background sessions (claude --bg), a Tasks page that puts your to-dos next to live agent work, and a daily report written as a markdown file.

**Alt text (tasks.png):** The Tasks page with a quick-add row on top and three lanes: To do (four tasks), In progress (tasks and live agent sessions, several marked "Needs you", "Working" or with a progress bar) and Done today (including one failed session). Sample data.

**Alt text (report.png):** The Daily report page: a list of days on the left, and on the right one day written out: agent time as the biggest figure, then sessions, turns, files changed, approvals answered and tasks done, a Done list, and agent work broken down by project with bars. Sample data.

(Both alt texts describe the screenshots that `npm run screenshots` generates from demo data. Re-read them if you regenerate the images.)

## 7/8 (225 chars)

Free, MIT, Windows 11 only for now. The v1 installer is unsigned (no certificate money), so SmartScreen will warn. The SHA-256 is on the release and the source is public, so you can build it yourself.

https://github.com/kurtgav/Agent-Desk

## 8/8 (232 chars)

What I would like: run it next to your real sessions and tell me what is wrong. I could not verify the VS Code extension or Claude Desktop's hooks on real sessions, so reports from those are the most useful.

Issues and PRs welcome.

---

## Pinned reply (227 chars)

Links, in one place.

Repo and releases: https://github.com/kurtgav/Agent-Desk
How the privacy rules are enforced: docs/adr/0010-security-model.md
Questions and ideas: Discussions on the repo

Reply here or open an issue. I read all of them.

---

## Notes

- Post the thread yourself at a time you can stay online for a few hours. The first questions arrive fast; see the reply templates in [CHECKLIST.md](CHECKLIST.md).
- A 15 to 25 second screen recording (a permission request appears, the toast fires, you click Approve, the session continues) can replace the still in post 3. Specs are in the checklist.
- Do not add hashtags in bulk. One `#ClaudeCode` at most, in post 2.
- Do not ask people to repost or star. Post 8 already has the ask.
- The alt texts describe the intended screenshots. Edit each one to match exactly what is in the final image.
