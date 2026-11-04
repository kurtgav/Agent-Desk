# Event schema

Every source is normalized into one `AgentEvent` before anything else happens. The reducers (STATE_MACHINE.md) derive Session, Agent and AttentionItem from events alone, so a replay of `events` always rebuilds the same state.

Input validation uses zod at every boundary (hook body, OTLP body, Reporter body, poll output). Unknown fields are kept in `payload`, and unknown events are stored as `kind: "unknown"` rather than rejected, so a Claude Code upgrade cannot break ingest.

## AgentEvent

```ts
export const EventSource = z.enum(['hook', 'poll', 'otel', 'reporter', 'agentdeck']);

export const AgentEvent = z.object({
  id: z.string(),                    // ULID, assigned at ingest
  ts: z.number().int(),              // ms epoch, collector receive time
  source: EventSource,
  sessionId: z.string(),             // Claude session UUID (hook session_id / poll sessionId)
  agentId: z.string().nullable(),    // hook agent_id; null = main thread (spike S1)
  parentAgentId: z.string().nullable(), // null = parent is the main thread (nesting depth not exposed by hooks)
  agentType: z.string().nullable(),  // hook agent_type (also set on main thread under --agent)
  kind: EventKind,
  toolName: z.string().nullable(),
  toolUseId: z.string().nullable(),  // D-020: added for correlation; null on PermissionRequest
  summary: z.string().max(200),      // plain English, see § Activity text
  payload: z.record(z.unknown()),    // redacted source body
  cwd: z.string().nullable(),        // as given; compared case-insensitively (D-013)
});
```

## Kinds and the source of each

| kind | From | Extracted fields (source names exact) |
|---|---|---|
| `session.prompt` | `UserPromptSubmit` whose `prompt` does **not** start with `<task-notification>` | `prompt` (redacted, ≤ 2 KB) |
| `session.notified` | `UserPromptSubmit` whose `prompt` starts with `<task-notification>` (spike S1: async subagent result) | none; never counts as a turn |
| `tool.started` | `PreToolUse` | `tool_name`, `tool_input`, `tool_use_id`, `agent_id` |
| `tool.finished` | `PostToolUse` | `tool_use_id`, `duration_ms`, `tool_response` (≤ 2 KB) |
| `tool.failed` | `PostToolUseFailure` | `tool_use_id`, `error`, `is_interrupt` |
| `permission.requested` | `PermissionRequest` | `tool_name`, `tool_input`, `permission_suggestions` (correlated to `toolUseId`, see below) |
| `permission.denied` | `PermissionDenied` (auto mode) | `tool_use_id`, `reason` |
| `permission.decided` | AgentDeck remote decision, **or** OTel `tool_decision` | `decision`, `source`, `tool_use_id` |
| `notification` | `Notification` | `notification_type`, `message`, `title` |
| `turn.stopped` | `Stop` | `last_assistant_message` (≤ 8 KB), `stop_hook_active`, `background_tasks` |
| `turn.failed` | `StopFailure` | `error`, `error_details`, `last_assistant_message` |
| `subagent.started` | `SubagentStart` | `agent_id`, `agent_type` |
| `subagent.stopped` | `SubagentStop` | `agent_id`, `last_assistant_message` |
| `task.created` / `task.completed` | `TaskCreated` / `TaskCompleted` | `task_id`, `task_subject`, `task_description` |
| `context.compacting` | `PreCompact` | `trigger` |
| `cwd.changed` | `CwdChanged` | `old_cwd`, `new_cwd` |
| `session.ended` | `SessionEnd` | `reason` |
| `session.state` | poll diff (row added or changed) | `kind`, `pid`, `status`, `state`, `waitingFor`, `name`, `id`, `startedAt`, `surface` |
| `session.gone` | poll diff (row vanished) | last known row |
| `usage.metric` | OTLP metric data point (DELTA) | name, `type`, `model`, value, `session.id` |
| `usage.api_request` / `usage.api_error` | OTLP log `api_request` / `api_error` | `model`, tokens, `cost_usd`, `status_code`, `error` |
| `unknown` | any unrecognized hook event or field shape | whole body (redacted) |

Every hook event also keeps `permission_mode`, `effort.level` and `prompt_id` in `payload`. `transcript_path` and `scratchpad_dir` are **dropped** (ADR-0009).

## Correlation rules (spike S4)
- **PermissionRequest → toolUseId.** PermissionRequest carries no `tool_use_id`. Match it to the latest open `tool.started` for the same `(sessionId, agentId)` with the same `tool_name` and a deep-equal `tool_input`. Claude Code always sends `PreToolUse` first.
- **Permission outcome.**
  - `tool.finished` or `tool.failed` with that `toolUseId` means approved.
  - Any later event for the same `(sessionId, agentId)` other than `notification` (most often `turn.stopped`, or a `tool.started` with a different id), with no Post for that id, means **denied**.
  - OTel `tool_decision.decision` confirms either outcome when telemetry is on.
- **Subagent.** `agentId != null` means the event came from inside a subagent. Subagent rows are keyed by `agent_id` and nested under the session. The Agent tool's `tool_response.agentId` links the delegating `tool.started` to the subagent (async launches: `status:"async_launched"`).
- **Poll ↔ hooks.** Join on `sessionId`. Background rows also carry the short `id` used by `attach`, `logs` and `stop`.

## Activity text (summary)
Built from the latest `tool.started` of each agent. Paths are shown relative to the session cwd when inside it. Commands are cut at 60 chars and redacted.

| tool_name | summary |
|---|---|
| Edit, Write, NotebookEdit, MultiEdit | Editing `src/app/page.tsx` |
| Read | Reading `README.md` |
| Bash, PowerShell | Running `npm test` |
| Grep | Searching "auth" |
| Glob | Finding files `**/*.ts` |
| Agent (Task) | Delegating to Explore |
| WebFetch / WebSearch | Fetching example.com / Searching the web for "…" |
| AskUserQuestion | Asking you: <first question> |
| ExitPlanMode | Plan ready for your review |
| TaskCreate / TaskUpdate | Updating the plan |
| `mcp__<server>__<tool>` | Using <server> · <tool> |
| anything else | Using <tool_name> |

## Redaction (applied before insert and before any preview)
- **OTel identity** is dropped: `user.email`, `user.account_uuid`, `user.account_id`, `organization.id`, `user.id` (spike: present on every signal).
- **Secrets** are masked in all strings with `•••`:
  - `(?i)(api[_-]?key|token|secret|passw(or)?d|authorization)\s*[:=]\s*\S+`
  - `sk-ant-[\w-]+`, `sk-[A-Za-z0-9]{20,}`
  - `gh[pousr]_[A-Za-z0-9]{36,}`, `github_pat_\w+`
  - `xox[abprs]-[\w-]+`, `AKIA[0-9A-Z]{16}`
  - JWTs: `eyJ[\w-]+\.[\w-]+\.[\w-]+`
  - PEM private keys
  - credentials in URLs: `\w+://[^:\s/]+:[^@\s]+@` (the password part)
- **Big fields:** `Write.content`, `Edit.old_string` and `Edit.new_string` are replaced by their lengths. `tool_response` is kept up to 2 KB, `prompt` up to 2 KB, `last_assistant_message` up to 8 KB.
- **Files whose contents are never previewed:** `.env*`, `*.pem`, `*.key`, `id_rsa*`, `credentials*`. Only the path is shown.

## Reporter API (`POST /v1/events`)
- The body is a JSON object or an array of up to 100 objects, `{sessionId, agentId?, agentType?, kind, toolName?, toolUseId?, summary, payload?, cwd?}`.
- `kind` must be one of the kinds above.
- `id`, `ts` and `source:"reporter"` are set by the collector.
- Same token and Origin rules as `/hooks`. The reply is `202` with an empty body.

## Fixtures
`spikes/fixtures/s1/*.json` holds real 2.1.318 payloads, redacted. `node spikes/check-fixtures.mjs` asserts each one has the fields this table maps from; in M2 the fixtures move to `test/fixtures/hooks/2.1.318/`. Events marked docs-only in COMPATIBILITY.md get hand-written fixtures labelled `docs-derived`.
