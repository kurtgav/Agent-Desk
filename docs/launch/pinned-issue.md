AgentDeck has been tested with Claude Code 2.1.317 and 2.1.318 on Windows 11. Four things are not verified, and I can't check them alone:

1. **VS Code extension sessions.** AgentDeck detects them from the process path, but none was open during testing (risk R9).
2. **Claude Desktop hooks.** Desktop sessions are listed, but whether Desktop's bundled Claude Code runs the user-level hooks is untested (R8).
3. **Remote approvals in an interactive terminal.** Does the terminal prompt wait while AgentDeck holds the request, and does it then show normally? Only `claude -p` is verified (R34).
4. **Your Claude Code version.** Does anything in `docs/COMPATIBILITY.md` differ from what you see?

If you can check any of these, comment with your Claude Code version, what you did, and what you saw. The output of "Settings, Diagnostics, Copy diagnostics" is useful. Thank you.
