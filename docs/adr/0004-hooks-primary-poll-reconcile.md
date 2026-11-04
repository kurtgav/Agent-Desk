# ADR-0004: Hooks drive real time; `claude agents --json --all` reconciles

- Status: Accepted, 2026-11-05

## Context
- Hooks arrive in real time but have blind spots:
  - there is no HTTP SessionStart (hooks § Prompt-based hooks);
  - nothing arrives from untrusted folders in interactive sessions (hooks § Workspace trust);
  - an approved long-running tool sends nothing until it finishes (S4).
- `claude agents --json --all` is the documented way to read session state from outside (agent-view § Read session state from a script). It lists interactive CLI, Desktop and background sessions (S8). Each call costs **312 ms of CPU at p50** and 440 ms of wall time (S5).

## Decision
- Every hook event updates state immediately. The poll is the source of truth for:
  - which sessions exist;
  - the background `state` and `id`;
  - `waitingFor`;
  - sessions with no hook traffic.
- Cadence (D-005):

| Condition | Interval |
|---|---|
| Window visible | 3 s |
| Window hidden | 15 s |
| A P1 item is open | 1 s, for up to 2 min per item |
| After a hook event | one extra poll, 300 ms debounce |

  Only one poll runs at a time, with at least 1 s between polls.
- The output is parsed with zod as an array of rows (unknown fields kept). If it isn't an array, or the process exits non-zero, the poller backs off to 60 s, Diagnostics shows "Session registry unavailable", and AgentDeck runs on hooks alone.
- Precedence: a hook event wins over the poll for 5 s, so a lagging poll can't flip state back (STATE_MACHINE § 1).

## Consequences
- **CPU per window state** (12 logical CPUs):

| Window state | Cost |
|---|---|
| Hidden | ≈ 0.2 % of the machine |
| Visible | ≈ 0.9 % |
| P1 bursts | ≈ 2.6 % |

  The idle budget (< 1 %) is measured with the window hidden (M5).
- If a future CLI version makes the poll cheaper or adds a push channel, only the poller module changes.
