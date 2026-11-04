# Reference → AgentDeck UI map

The visual spec is `docs/reference/dashboard.png`. AgentDeck matches its layout, spacing, hierarchy, density and visual language. The reference's product name, logo and mascots are replaced with an original AgentDeck mark and with generated avatars: each agent gets a fixed shape (6 options) and hue (12 options) derived from a hash of its `agentType` or session name, all with WCAG AA contrast (D-015).

**Rule: every element maps to real data or a real action. Anything that doesn't is dropped.**

## Layout tokens (tuned in M1 against the reference measured at 1440×924; source of truth is `src/renderer/src/styles.css`)
- **Grid:** 4/8 px. Sidebar 216 px, collapsible to 64 px. Top bar 48 px. Canvas padding 36 px sides, 24 px top and bottom; content max width 1280 px; card gap 16 px.
- **Columns:** greeting : composer = 5 : 8 (keeps the summary on one line); KPI row 4 equal cards, 134 px tall; main : right = 2 : 1. Below a 1280 px window the right column wraps under the main one as a 2-column row (`tests/home.spec.ts` checks it at 1200×760).
- **Row caps:** Needs you 3 (the rest behind "See all (N more)"), Running now 4, Recent files 4, Your agents 6. At 1440×924 Home fits without scrolling; the smoke test fails if it doesn't.
- **Surfaces:** ground `#F6F6F6`; cards `#FFFFFF` with a 1 px `#EAEAEA` border, no shadow; row rules `#F1F1F2`; tiles `#F6F6F6`; code/well `#F2F2F3`; control borders `#DCDCDF`. Shadows only on floating layers (menus, tooltips, dialog).
- **Radius:** cards 16, tiles 12, icon tiles 8, pill buttons 999.
- **Type:** Inter Variable (bundled), tabular numbers for every count, time and money. Sizes:

| Role | Size / weight |
|---|---|
| Greeting | 28/600, −0.02em |
| KPI value | 28/600 |
| Card title | 15/600 |
| Body / row title | 14/400 |
| Labels, buttons | 13/500 |
| Meta | 12/400 in `#6B6B72` |

- **Color:** ink `#18181B`, muted `#6B6B72` (≥ 4.5:1 on ground and white). Accent `#0A84FF` for marks, bars and focus rings; filled buttons use `#0071E3` (hover `#0064C8`) because white on `#0A84FF` is only 3.65:1 (D-032).
- **Status:** each pill is a dot plus a label; label ink is the dark shade so text passes AA on the fill.

| Status | Dot | Pill fill | Label ink |
|---|---|---|---|
| Working | `#0A84FF` | `#E6F0FE` | `#0B4FA8` |
| Needs you | `#F59E0B` | `#FEF3C7` | `#92400E` |
| Failed | `#EF4444` | `#FEE2E2` | `#991B1B` |
| Idle | `#A1A1AA` | `#EFEFF1` | `#52525B` |
| Done | `#22C55E` | `#DCFCE7` | `#166534` |

- **Themes and motion:** tokens are CSS variables, light theme now, with a `[data-theme=dark]` block ready. Motion lasts 120–200 ms ease-out and is disabled under `prefers-reduced-motion`.
- **Icons:** lucide, 16 px, stroke 1.75.

## Sidebar
| Reference | AgentDeck | Data / action |
|---|---|---|
| "Fennel ▾" switcher + logo | **Third Code ▾** with the AgentDeck mark | Menu: About, Diagnostics, Demo mode toggle (labelled), Quit is in the tray only |
| Sidebar collapse icon | collapse | toggles 232/64 px; state in `kv` |
| + New | **New task** | focuses the composer |
| search icon | search | opens the Ctrl+K palette |
| Home | Home | route |
| Projects | **Sessions** | all sessions table (live + 30 d history), filters by surface/status/project |
| Templates | **Approvals** + badge | open P1 items + audit log; badge = open P1 count |
| Artifacts | **Files** | `files` table, grouped by project |
| Tasks + count | **Activity** | event timeline across sessions |
| Recent (4 projects) | **Recent** | 5 most recently active project folders (cwd, normalized); click filters Sessions |
| Teams (Product, Growth) | **Agents** | subagents used in the last 7 days (max 6, from `subagent.started.agentType`) + "All agents (N)" → page listing `~/.claude/agents` and project `.claude/agents` (name, description, model, color from frontmatter; read-only). 346 exist on this machine, so they are never listed inline |
| Credits card (760 left of 2,000, Pro, Resets, Upgrade) | **Usage** card | today and this week tokens + **estimated** cost vs the budget you set; progress bar = week vs budget. Telemetry off → "Enable usage (OTel)" button (consent flow, ADR-0007). No plan badge, no Upgrade |
| Maya Chen + email + gear | **Kurt** + settings gear | display name from Settings (default "Kurt", D-014). No email or account data. Gear opens Settings |

## Top bar
| Reference | AgentDeck | Data / action |
|---|---|---|
| ⌂ Home breadcrumb + ☆ | breadcrumb | current route (Home / Sessions / session name). Star dropped (no data) |
| Search in project ⌘K | **Search… Ctrl+K** | palette: sessions, projects, files, actions (New task, Pause notifications, Diagnostics, Install integration…) |
| blue app chip | **Live chip** | `Live` (hooks installed + collector up + event or poll < 30 s), `Paused` (notifications paused), `Hooks missing` (red; click to Repair) |
| avatar stack | active agents | up to 3 avatars of Working/Needs-you sessions, "+N" overflow; click → Sessions |
| Share | **New task** (pill) | focuses composer / opens dispatch dialog |
| ⋯ | overflow | Pause notifications (1 h / until tomorrow / resume), Diagnostics, Settings |

## Greeting + composer
| Reference | AgentDeck | Data / action |
|---|---|---|
| "Tuesday, November 3" | local date | `Intl.DateTimeFormat` |
| "Good morning, Maya" | "Good morning/afternoon/evening, Kurt" | local hour |
| "3 things need your OK. Agents finished 6 tasks overnight." | live summary | "{P1 count} things need your OK" (omitted at 0) + "Agents finished {n} tasks while you were away" (since the window last had focus, D-007); fallback "All quiet." |
| Composer "Ask your agents to…" | dispatch composer | `claude --bg --name <auto> [--agent a] [--model m] [--effort e] "<prompt>"` via cross-spawn, arg array, cwd = chosen project. Errors are shown inline; `Workspace not trusted` → "Open a terminal in <folder> and run `claude` once to trust it" + button that opens a terminal there |
| + | project picker | recent cwds + Browse… |
| @ | subagent mention | inserts `--agent` choice |
| mic | **dropped** | no data/action |
| Agent ▾ | subagent picker | sets `--agent` |
| ⚡ Max chip | effort chip | cycles low, medium, high, xhigh, max → `--effort` |
| ↑ send | send | dispatch; disabled while prompt empty or no project |

## KPI cards
| Reference | AgentDeck | Definition |
|---|---|---|
| Time saved this week · 9h 15m · "1h 40m more than last week" | **Agent time this week** | summed working intervals (D-012), "▲/▼ Xh vs last week". **Never "time saved"** |
| Tasks finished · 24 · "6 finished overnight" | **Tasks finished** | completed turns this week (D-010), "N while you were away" |
| Waiting for you · 3 · "The oldest is 2 hours old" | **Waiting for you** | open P1+P2 (D-009), "The oldest is {age} old" |
| Files made · 18 · "Sheets, decks…" | **Files changed** | distinct paths via edit tools this week (D-011), "across N projects" |

## Main column
| Reference | AgentDeck | Data / action |
|---|---|---|
| Needs your approval (3) + See all | **Needs you** (count) + See all → Approvals | attention items sorted priority→age (STATE_MACHINE § 3). Row: type icon, title (exact tool/command or question), meta "agent · project · age", risk flag chips |
| Reject / Approve | actions | **Only on held P1 approvals** (remote approvals on). Risky items → confirm dialog showing the full command. Otherwise: **Attach** (bg), **Open in Desktop** (Desktop surface), **Answer in terminal** (interactive CLI; shows cwd), **Open**, **Dismiss** (P2–P4) |
| Running now (4) + View tasks | **Running now** (count) + View all → Sessions | one row per working/needs-you session; subagents nested (indented, type + task). Activity text from latest tool (EVENT_SCHEMA § Activity text). "Step 2 of 4" from tasks; bar determinate only with a plan, else indeterminate |
| "About 2 min left" | caption | elapsed "12m" or "Waiting 3m". **No ETAs** |

## Right column
| Reference | AgentDeck | Data / action |
|---|---|---|
| Recent files + See all | **Recent files** | last 4 from `files`: name, "project · agent · 2 min ago", type icon from extension. Click → `code -g <path>` (cross-spawn; error toast if VS Code missing). See all → Files |
| Your agents (6) tiles | **Your agents** | one tile per active or recent (24 h) session/agent: generated avatar, name, status pill. Click → session drawer |

## Session drawer (opens from any row)
- **Header:** name, surface, cwd, status pill, model (OTel or `--model`), started.
- **Tabs:** Timeline (live events), Plan (tasks), Files, Final message (`last_assistant_message`, markdown, sanitized), Logs (`claude logs <id>` for bg, ANSI → styled text, refresh button).
- **Actions:**
  - **Attach:** `wt -d <cwd> claude attach <id>` when `wt.exe` exists, otherwise spawn `claude attach <id>` with `detached:true` (new console window, F13).
  - **Stop:** `claude stop <id>`, behind a confirm dialog.
  - **Open in VS Code:** `code <cwd>`.
  - **Copy resume:** `claude --resume <sessionId>`.
  - Live interactive sessions show "Answer in its terminal" + cwd; Desktop sessions show "Open in Claude Desktop" (`claude --desktop --resume <sessionId>`, verify M4).

## Dropped from the reference (no real data or action)
Mic button, Share, favorite star, Templates, Artifacts as "files made", "Time saved", ETA captions ("About 2 min left"), plan badge "Pro", "Upgrade", credits "left of 2,000", "Resets Nov 1", email under the user name.

## Accessibility
- Full keyboard path: Tab order follows the visual order, plus shortcuts:

| Key | Action |
|---|---|
| Ctrl+K | command palette |
| `g h` / `g s` / `g a` | go to Home / Sessions / Approvals |
| Enter | open the focused row |
| A | approve a held item (confirm required) |
| R | reject a held item (confirm required) |
| Esc | close the drawer |

- Visible 2px focus ring in the accent color.
- Text and pill contrast meets WCAG AA (pill text uses `#18181B` on tinted fills).
- Status is never shown by color alone: there is always a dot + label.
- Live updates go to an `aria-live="polite"` region for Needs-you changes.
