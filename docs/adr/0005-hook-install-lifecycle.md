# ADR-0005: Hook entries exist only while AgentDeck runs; strict settings.json writer

- Status: Accepted, 2026-11-05 (from spike S2, which the brief asked to settle this)

## Context
- The brief says: if anything reaches the user or the model when the endpoint is down, install hooks only while AgentDeck runs.
- S2 measured the endpoint-down case:
  - Each hook becomes a non-blocking error costing 4–57 ms, and the model is unaffected.
  - In `-p` mode, stderr prints `SessionEnd hook [http://127.0.0.1:47821/hooks] failed: connect ECONNREFUSED 127.0.0.1:47821`. Script and SDK users see it.
  - The docs say non-blocking errors show as `<hook name> hook error` notices in the transcript on events such as PreToolUse.
- Settings files are watched, and `hooks` edits apply to running sessions (settings § When edits take effect). Adding and removing entries therefore reaches sessions that are already open.

## Decision
1. **Lifecycle**
   - Launch: merge our entries.
   - Quit: answer held approvals with an empty reply, then remove our entries.
   - Next launch: reconcile any leftovers. A crash leaves them in place until then (R2).
2. **Entry shape**, one per event:

   ```json
   {"type":"http","url":"http://127.0.0.1:<port>/hooks","timeout":2,"headers":{"X-AgentDeck-Token":"<token>"}}
   ```

   - It has no `matcher`, which matches all, and no custom fields.
   - Events: SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, PermissionDenied, Notification, Stop, StopFailure, SubagentStart, SubagentStop, TaskCreated, TaskCompleted, PreCompact, CwdChanged.
   - SessionStart is excluded (D-004).
   - With remote approvals on, PermissionRequest's `timeout` is `approvalWaitSec + 10`.
3. **Identity.** An entry is ours if it is `type:"http"`, its url matches `^http://127\.0\.0\.1:\d+/hooks$`, and it has an `X-AgentDeck-Token` header (D-022). We never touch any other entry.
4. **Writer rules.** Main is the only writer.
   - Resolve the path: `CLAUDE_CONFIG_DIR` or `%USERPROFILE%\.claude`, then `settings.json`.
   - Read and parse. If parsing fails: **abort**, write nothing, and show Diagnostics.
   - Compute the merged object: our entries removed, then the current ones added, in a stable order.
   - If nothing changed, do nothing (idempotent).
   - Otherwise:
     1. Back up the original to `%APPDATA%\AgentDeck\backups`.
     2. Write a temp file next to the target.
     3. Re-read the target and compare it with the hash read in the first step. Retry up to 3 times if it changed.
     4. Rename atomically.
     5. Re-read and validate that our entries are present and every foreign key is unchanged (deep-equal).
   - **The first install, and any change in shape, shows a diff and needs an explicit OK.** Later launch/quit toggles reuse that consent. Each one is still backed up, and it is logged and visible in Diagnostics.
5. **Uninstall integration** removes only our entries, then leaves `settings.json` byte-identical except for those entries, plus a trailing newline if the file had one. The NSIS uninstaller runs it (ADR-0012).
6. **Diagnostics** flags conflicts:
   - `disableAllHooks: true` in any scope;
   - `allowedHttpHookUrls` set without a pattern matching our URL;
   - `httpHookAllowedEnvVars` (not needed, informational);
   - managed `allowManagedHooksOnly`.
7. **Command-hook fallback.** None in v1. If one is ever needed, it must use exec form `{"command":"node","args":[…],"onFailure":"continue"}` with a real `.exe` (hooks § Exec form and shell form).

## Consequences
- With AgentDeck closed or quit cleanly, Claude Code sees no AgentDeck hooks at all: **zero impact**.
- After a crash, leftover entries remain until the next launch. Autostart at login makes that window short.
- Each launch and quit writes `settings.json` once. The backups ring stays bounded at 20 files.
