# ADR-0013: One attention engine produces every "needs you" signal

- Status: Accepted, 2026-11-05

## Context
- Several surfaces report the same fact:
  - the Needs-you list
  - the Approvals badge
  - the taskbar overlay
  - the tray dot
  - `flashFrame`
  - toasts
  - the greeting sentence
  - the "Waiting for you" KPI
- If each derived it on its own, they would drift: one cleared, another still showing.

## Decision
- The collector's attention engine (STATE_MACHINE § 3) is the only producer of `attention_items`. Every surface above reads open items through one selector, `openItems({minPriority})`.
- Main receives item open and resolve events over the MessagePort and drives:
  - the badge, which counts P1 + P2;
  - the tray dot;
  - `flashFrame` on a new P1 while the window is unfocused;
  - toasts, with these rules: P1 and P2 always; P4 only if "completions" is on; respect quiet hours and per-type toggles; suppress when the item is already visible in the focused window; clicking a toast opens the item.
- Each resolution records `resolvedBy`: `hook`, `poll`, `otel`, `agentdeck`, `user-dismiss` or `session-ended`. Diagnostics shows the median time from answer to resolve for each source, which tracks the 2 s target.

## Consequences
- Every surface clears within the same tick, because they share a source.
- The engine's unit tests double as the contract for the whole UI.
