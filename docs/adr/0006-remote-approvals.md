# ADR-0006: Remote approvals by holding the PermissionRequest hook (opt-in)

- Status: Accepted, 2026-11-05. Behaviour verified in `-p` (S4); the interactive deferral is pending S7b.

## Context
- PermissionRequest decision control (hooks § PermissionRequest decision control):
  - `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}` allows the call.
  - `"behavior":"deny","message":"…"` denies it.
  - Deny rules still win over a hook's allow.
- S4 confirmed:
  - Allow → the tool ran.
  - Deny → the model saw `Rejected in AgentDeck`.
  - An empty reply in `-p` → the call was denied.
  - Interactive sessions show the normal dialog when no decision is returned. This is implied by the docs and still to confirm in S7b.

## Decision
- Remote approvals are **off by default** (D-017). Turning them on:
  - sets the PermissionRequest entry's `timeout` to `approvalWaitSec + 10` (default 70 s);
  - shows a Settings note: "While AgentDeck waits (up to 60 s), the terminal prompt is deferred." Until Settings (M5), the switch and the note live in the install dialog, next to the diff they cause (D-104).
- While on, the collector holds each PermissionRequest whose row shows exactly what would run (D-113: a plain command, path, URL or query, nothing masked or cut) and opens a P1 item with **Approve / Reject**; any other request goes to its terminal at once:
  - **Approve** replies `decision.behavior:"allow"`.
  - **Reject** replies `"deny"` with `message:"Rejected in AgentDeck"`.
  - **Wait expiry, quit, or the session ending** → an empty 200, so the normal prompt appears. A crash resets the connection, which Claude treats as non-blocking, so the normal prompt appears in that case too.
- Guardrails:
  - Approve-once only. No bulk approve. No `updatedPermissions`, so AgentDeck never adds rules.
  - Items with a risk flag (STATE_MACHINE § 5) need a confirm dialog that shows the full command.
  - Approve and Reject are only reachable from the UI with a fresh user gesture. There is no REST-only path without the renderer's session nonce.
  - Every decision writes an `approvals` row: ts, session, agent, tool, input hash, redacted preview, decision, wait time, outcome. *M4:* the outcome is how the hold ended (approved, rejected, timed-out, abandoned, released); what the tool then did is on the session timeline (D-107). The row is written before the reply, and a decision that can't be logged is not sent (D-114).
- When off, P1 items offer Attach / Open in Desktop / Answer in terminal.

## Consequences
- AgentDeck relays only explicit clicks. It never decides by itself.
- Sessions that cannot show a prompt (`-p`, SDK) deny on an empty reply. That matches what happens without AgentDeck.
