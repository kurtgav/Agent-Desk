# Show HN

HN does not render markdown, so the comment below is plain text with blank lines between paragraphs. Paste it as is.

Before you post, read the [Show HN rules](https://news.ycombinator.com/showhn.html) and the [guidelines](https://news.ycombinator.com/newsguidelines.html). Two that matter here: it must be something people can try (the release installer and the source both count), and you must not ask anyone to upvote, or have friends do it.

## Title (79 characters)

Show HN: AgentDeck - a local Windows tray app for all your Claude Code sessions

**URL:** https://github.com/kurtgav/Agent-Desk

Submit the repo link, not a blog post. If you later write a post about the hook findings, that is a separate submission, not a Show HN.

## First comment (post it as soon as the submission is up)

Hi HN, I'm Kurt, the author. AgentDeck is a Windows tray app that watches every Claude Code session on your PC (terminal, Claude Desktop, background runs) and tells you which one needs you.

The problem: once you run several sessions at once, one of them stops to ask for permission and nothing says which. You find out when you happen to look at the right window. AgentDeck keeps one queue, sorted by priority (needs approval or an answer, failed, looks stuck, ready for review), and sends a toast and a taskbar badge when something is waiting.

How it works: Claude Code's HTTP hooks post each event to a small collector on 127.0.0.1, and a poll of `claude agents --json --all` finds the sessions hooks don't cover. The collector replies at once and does its work afterwards, because a slow hook endpoint costs the session up to the hook's timeout. On a real `claude -p` run it took 113 ms (median) from hook to screen. Hooks are added to ~/.claude/settings.json only after you accept a diff, and removed when you quit.

The stance I care about: it listens on loopback only, makes no outbound requests and no model calls of its own, never reads the content of your transcripts (one opt-in switch, off by default, reads only token counts from the local logs), and never approves anything by itself. There is an opt-in mode where you can Approve once or Reject a permission request from AgentDeck; it needs a click in the window and every answer goes in an audit log. The threat model is docs/adr/0010-security-model.md.

What is missing, so you don't have to find out:

  - Windows 11 only. No macOS or Linux build in v1.
  - The installer is unsigned, so SmartScreen warns. The SHA-256 is on the release, and the source is MIT if you'd rather build it.
  - I haven't verified the VS Code extension or Claude Desktop's hooks on real sessions. The compatibility matrix marks each row as spike, live, docs-only or unverified.
  - I haven't verified what an interactive terminal prompt does while AgentDeck holds a permission request, only the `claude -p` behaviour, so that mode is off by default.

I'd most like to hear: where the privacy claims above are weaker than they sound, and whether the compatibility notes match what you see on your Claude Code version.

## If it gets traction

- Answer in the thread, not by email. Stay for a few hours.
- Reply to criticism with the specific doc or number, or say "you're right, filed as an issue" and file it.
- If someone finds a real security problem, thank them and ask them to use private vulnerability reporting (SECURITY.md); fix it before you say more in public.
