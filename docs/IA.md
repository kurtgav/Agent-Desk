# Information architecture v2: one place to work

The model is Claude Desktop's Code tab, kept honest to what AgentDeck is: **sessions on the left, the open session in the middle, one composer at the bottom, details on the right when you want them.** Every agent is visible and every agent can be mentioned with `@`. Everything else is one click away and out of the way.

This replaces the v1 shell, where a dashboard, a console, a session list, a drawer and eight pages each owned part of "the thing I am working on". Decisions that follow from it are logged in `DECISIONS.md` when they ship.

## 0. Design stance: simpler than Claude Desktop, not a copy of it

The owner's brief: Claude Desktop is complicated and has many bugs; AgentDeck should be much better, open source, polished and established. The layout below is borrowed (people already know it) but the rules are stricter:

1. **One concept.** Everything is a session. No modes, no tabs that mean different things.
2. **Progressive disclosure.** The default screen has one composer and one list. Model, effort, permission mode, extra folders and prompts live behind a quiet "Advanced". A first-time user never has to know they exist.
3. **Nothing happens silently.** Every action shows its result or its error in plain words, with the fix. No spinner that never ends, no button that does nothing, no state that is only visible in a log.
4. **Undo beats confirm.** Archive, rename, pin and task changes are instantly reversible. Only irreversible actions (deleting a background session) ask first.
5. **The app does not break.** A failing page shows a recovery card, not a white screen; a crashed collector restarts and says so; every list has loading, empty and error states; a parser never throws on input it did not expect.
6. **Fast and light.** Budgets are tests, not wishes (see `QUALITY.md`).
7. **Private by construction.** No network, no accounts, no telemetry: enforced by a test, not just by a README line.

## 1. One concept: a session

A **session** is any Claude Code conversation AgentDeck knows about. It has a name, a project folder, a role, a status and a time. Two origins, one list, one view:

| Origin | What you can do | Badge |
|---|---|---|
| **Started here** (the Composer, formerly the Console) | read the live thread, reply, stop, resume, fork | none |
| **Watching** (started in a terminal, Claude Desktop, VS Code, `--bg`) | read its timeline, plan and files, approve what it asks (remote approvals), go to its window, continue it here as a fork | a quiet "Watching" tag |

"Console" stops being a page. There is no separate list of conversations: they are sessions.

## 2. The frame (always the same)

```
┌ Sidebar 272 px ─────────┬ Main ───────────────────────────────────────────┬ Details 320 px (toggle) ┐
│ New session   Ctrl+N    │  header: name · @role · folder · status · ⋯     │  Plan / tasks            │
│ Search        Ctrl+K    │  ─────────────────────────────────────────────  │  Files changed           │
│ Tasks                   │  the open session (thread or timeline)          │  Activity                │
│ Approvals               │                                                 │  Usage of this session   │
│ Daily report · Agents   │                                                 │                          │
│ Files · Activity · …    │                                                 │                          │
│ Needs you (2)           │  ─────────────────────────────────────────────  │                          │
│ Sessions  Pinned, Today │  composer: @ mention · / commands · chips       │                          │
│   …       Yesterday     │                                                 │                          │
│ ─────────────────────── │                                                 │                          │
│ Usage                   │                                                 │                          │
│ profile · Settings · ⇤  │                                                 │                          │
└─────────────────────────┴─────────────────────────────────────────────────┴──────────────────────────┘
```

- The sidebar never changes between pages. Pages (Tasks, Daily report, Approvals, Files, Activity, Agents, Settings, Overview) open in the main pane; the sidebar stays.
- The details panel is the old session drawer, promoted: it opens beside the session, remembers open or closed, and is closed below 1280 px.
- Light and dark, both fully designed. 1200 × 760 is the minimum window.

## 3. Sidebar, top to bottom

Calm by rule (D-169): one line per row, 32 px rows, 16 px icons, 14 px labels, grey sentence-case group labels, the current page as a grey pill, a count only where something waits for you.

1. **New session** (primary button, Ctrl+N) and **Search** (Ctrl+K). New session opens the *new session screen* (section 5).
2. **Workspace**: a labelled list, icon and word on every row: Tasks, Approvals, Daily report, Agents, Files, Activity, Overview. Settings sits in the footer.
3. **Needs you**: only when something waits, with its count. One line per item (kind icon in its colour, what it asks, age), the most urgent first. Click a line to see the session and answer it in place; a toast you click opens its line. A session waiting with no item is one line that goes to its window. The list scrolls in a short region and gives way first in a short window.
4. **Sessions**: **Pinned**, then **Today / Yesterday / This week / Earlier**, newest activity first. Archived are hidden. Row anatomy: status mark, name (the local alias if renamed), relative time; unread is a bolder name; folder and "started elsewhere" are in the tooltip. Right-click or the row's ⋯ opens the session menu. The Sessions page ("All sessions") has the filters, the project filter and the archive; grouping by project is gone (D-169). The list is virtualised past about 200 rows.
5. **Footer**: one usage line (honest states) with today's figures under it when the window is tall enough, the 5-hour window in its tooltip and in Settings; profile, Settings, collapse.

Agents are a page (the catalog, with the division rail and the filter), not a tree in the sidebar: there the tree was the noisiest thing on screen. `@` in any composer still reaches every agent in one keystroke.

Collapsed (64 px): icons only, tooltips, the same order.

## 4. The open session (main pane)

- **Header**: name (editable inline = local rename), `@role` chip (click to switch role for the next message), project chip (click opens the folder menu), status pill, cost, **⋯** (the session menu: same as right-click), **Details** toggle, Stop when running.
- **Started here**: the transcript (messages, collapsed thinking, tool cards, turn footers), as built in the Console.
- **Watching**: the timeline (what it did, newest at the bottom like a transcript), the plan, the files, and a calm banner: "Started in a terminal. Reply there (**Go to window**) or **Continue here** to fork it into a new session."
- **Composer** at the bottom of both. For a watched session the composer is replaced by those two buttons: AgentDeck never types into someone else's terminal.

## 5. New session screen (the landing page)

What opens on launch and on Ctrl+N, instead of the old dashboard: one **composer** across the width (up to about 1040 px), below it *Suggested agents* (from the text as you type, no model), then *Needs you* if anything waits, then *Recent sessions* beside *Ways to begin* (one row of three when there are no sessions yet). The old Home KPIs and "Your agents" tiles move to the **Overview** page (kept, one click away in Workspace).

## 6. The composer (one component, used everywhere)

One `Composer` replaces the Home composer, the Console composer and the Tasks quick-add. Chips row under the text: **folder**, **@role(s)**, **model**, **effort**, **permission mode**, plus an **Advanced** disclosure.

- `@` opens a mention menu over **every agent** (about 350): emoji, name, division, vibe; fuzzy search with synonyms (`@cto`, `@qa`, `@fe`, `@marketing`); keyboard (arrows, Enter or Tab inserts, Esc dismisses); recently used and pinned first; the whole menu is one accessible combobox. The mention becomes a **chip inside the text** (backspace removes it as one unit).
- Meaning of a mention:
  - **First message of a new session, `@CTO ...`**: the session *runs as* that agent (`--agent`), shown in the header.
  - **Several, `@CTO @QA ...`**: the first leads, the others are available to it as subagents for this session, and the message asks it to consult them.
  - **Later message, `@QA review this`**: that one message is addressed to that agent (delegated as a subagent turn), the session's own role does not change.
- `/` opens skills and slash commands (as built). `Enter` sends, `Shift+Enter` newline, `Ctrl+Enter` always sends, `Esc` stops a running turn, `Ctrl+.` also.
- Suggestions: while typing, up to three **suggested agents** appear as chips (deterministic ranking over the role descriptions; the reason is on hover). One click inserts the mention.
- Task quick-add and the Tasks page accept `@role` the same way: the role is stored on the task and used when it is sent to an agent.

## 7. What gets renamed, merged, removed

| Today | In v2 |
|---|---|
| Home dashboard | **Overview** (Workspace). Landing is the new session screen. |
| Console page + rail | gone as a page; its conversations are Sessions in the sidebar; its thread is the main pane |
| Sessions page | **Sessions** manager (filters, sections, archived, bulk), reached from "All sessions" at the bottom of the sidebar list; the sidebar list is the daily driver |
| Agents page | **Agents** catalog page (cards, detail, create/edit); the sidebar panel and `@` are the daily drivers |
| Session drawer | the **Details** panel |
| Needs-you card on Home | the sidebar section (and Overview) |
| Top bar | slimmed to: breadcrumb or session title, theme toggle, live chip, notifications menu. No second "New task". |

Unchanged in behaviour: Approvals, Files, Activity, Daily report, Tasks, Settings (they gain the frame, not new rules). Approve-once and the audit log still need a click in the window.

## 8. Keyboard

Ctrl+N new session · Ctrl+K search and jump (sessions, agents, pages, files) · Ctrl+Shift+A open Agents · Ctrl+1..9 jump to the nth session in the sidebar · Ctrl+B toggle sidebar · Ctrl+Alt+D toggle Details · `@` mention · `/` commands · Esc stop or close · context menu key or Shift+F10 on a row.

## 9. Acceptance

1. A new user sees where to start in one second: one composer, one list.
2. Typing `@c` shows CTO first; `@qa` finds QA agents; every one of the ~350 agents is reachable from the Agents page and from `@`.
3. No page needs the sidebar to change; no feature loses a way in (Approvals, Files, Activity, Report, Tasks, Settings all stay reachable in two clicks or Ctrl+K).
4. Needs-you items are visible on every screen without scrolling the main pane.
5. Light and dark, 1200 × 760 and 1440 × 924, keyboard-only, axe clean, reduced motion.
6. Demo mode shows the same layout with believable data, so screenshots are honest.
