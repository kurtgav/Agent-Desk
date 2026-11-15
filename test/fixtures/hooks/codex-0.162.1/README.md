# Codex CLI 0.162.1 hook bodies

Captured on Windows 11 on 2026-11-15 with a logging shim (spike S0, ADR-0014): one `codex exec` turn that ran `node --version` and created a file with `apply_patch`. `_order.txt` is the order they arrived in.

Every field name, its type and its place are as Codex sent them. Every value is replaced: ids, paths, the prompt, the tool output and the final message are sentinels, so no real content is committed.

Two files are shaped from the Codex hooks reference and the captured common fields, not captured: `PermissionRequest-1.json` (`codex exec` forces approval to `never`) and `Interrupt-1.json` (needs Esc in the TUI). Replace them with captures from an interactive run.

On Windows, Codex runs a hook's command as `powershell.exe -NoProfile -Command "<command>"`, and that PowerShell's parent is `codex.exe`.
