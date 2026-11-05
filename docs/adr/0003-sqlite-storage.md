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

## M2 amendment (2026-11-05)
- **`node:sqlite` (`DatabaseSync`), not better-sqlite3 (D-042).** Electron 45 ships Node 24, which has it built in, so there is no native module and no ABI rebuild (closes R15). The collector starts with `--disable-warning=ExperimentalWarning` so the module's notice doesn't reach the log.
- **M2 tables:** `events` (its `dedupe_key UNIQUE` column is written NULL: dedupe is a 2 s in-memory window, D-056), `sessions` (the reducer state as JSON, subagents and inflight tools included), `work_spans`, `finished_turns`, `files`. Migrations are an ordered list in `src/collector/store.ts`, each in one transaction, tracked by `PRAGMA user_version`. `attention_items` and `approvals` come with M3's migration and `usage` with the OTel receiver. Settings stay in `config.json`, so there is no `kv` table yet.
- **Retention:** the 30-day prune runs at launch and every 6 h. The file does not shrink after a prune (no `auto_vacuum`); revisit if it passes 100 MB.
- In memory the collector keeps every session plus spans, turns and files since the start of last week; the snapshot is built from that, never from a table scan.
- `demo.db` is not used yet (ADR-0011 M2 note).
