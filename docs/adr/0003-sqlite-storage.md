# ADR-0003: SQLite (better-sqlite3, WAL) as the only store

- Status: Accepted, 2026-11-05

## Context
The UI paints the last-known state at launch, then streams live data. The history must survive restarts and sleep. Everything is local, with one writer and modest volume: S1 produced 28 events per minute of agent work.

## Decision
- One database, `%APPDATA%\AgentDeck\agentdeck.db`, opened by the collector only.
- Pragmas: `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`.
- Tables: `events`, `sessions`, `agents`, `attention_items`, `approvals`, `files`, `usage`, `kv` (ARCHITECTURE § 4). Migrations are numbered SQL files run at startup inside one transaction.
- Events are appended in batched transactions, one per drain of the ingest queue. Derived tables are updated in the same transaction, so a crash never leaves them inconsistent.
- Retention: 30 days by default and configurable. `approvals` is kept 1 year (it is the audit log). The prune runs at launch and daily, followed by `PRAGMA incremental_vacuum`.
- Demo mode uses a separate file (ADR-0011).

## Consequences
- better-sqlite3 is synchronous, which is fine inside the utilityProcess (not main). It needs an Electron ABI rebuild (R15).
- Replaying `events` rebuilds the derived tables, which serves as both the test oracle and the repair path.
